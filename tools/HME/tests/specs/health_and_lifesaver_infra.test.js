'use strict';

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { createProxyRouteDispatcher } = require('../../proxy/hme_proxy_routes.js');

function currentSha() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..', '..'),
    encoding: 'utf8',
  }).trim();
}

function response() {
  return {
    statusCode: 0,
    body: null,
    writeHead(status) { this.statusCode = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function dispatchHealth(supervisor, gitSha = currentSha()) {
  const res = response();
  const dispatcher = createProxyRouteDispatcher({
    PORT: 9099,
    PROXY_VERSION: 'test',
    PROXY_GIT_SHA: gitSha,
    PROXY_STARTED_AT: 'test-start',
    routeMetrics: {},
    stopGateHealth: () => ({}),
    supervisorStatus: () => supervisor,
    loadedMiddleware: [],
  });
  assert.strictEqual(dispatcher({ url: '/health' }, res), true);
  return res;
}

module.exports.healthFailsClosedForRequiredSupervisorChildren = async function () {
  const res = dispatchHealth({
    worker: { required: true, alive: false, healthy: false, gaveUp: true },
    llamacpp_daemon: { required: false, alive: false, healthy: false, gaveUp: true },
  });
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.ok, false);
  assert.deepStrictEqual(res.body.supervisor_failures, ['worker']);
};

module.exports.healthAllowsOptionalSupervisorFailure = async function () {
  const res = dispatchHealth({
    worker: { required: true, alive: true, healthy: true, gaveUp: false },
    llamacpp_daemon: { required: false, alive: false, healthy: false, gaveUp: true },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.deepStrictEqual(res.body.supervisor_failures, []);
};

module.exports.healthFlagsStaleProxyRuntime = async function () {
  const res = dispatchHealth({
    worker: { required: true, alive: true, healthy: true, gaveUp: false },
  }, 'stale-sha');
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.runtime_stale, true);
};

module.exports.lifesaverEscalatesCriticalInfraSelfTags = async function () {
  const lifesaver = require('../../proxy/middleware/22_lifesaver_inject.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-lifesaver-infra-'));
  fs.mkdirSync(path.join(root, 'log'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools/HME/runtime'), { recursive: true });
  const errLog = path.join(root, 'log/hme-errors.log');
  fs.writeFileSync(errLog, '');
  const ctx = { PROJECT_ROOT: root, dirty: false, events: [], markDirty() { this.dirty = true; }, emit(e) { this.events.push(e); } };
  lifesaver.onRequest({ payload: { messages: [{ role: 'user', content: 'seed' }] }, ctx });
  fs.appendFileSync(
    errLog,
    '[universal_pulse] CRITICAL worker dead\n' +
      '[supervisor] child_restart_limit worker\n' +
      '[universal_pulse] observed tick\n',
  );
  const payload = { messages: [{ role: 'user', content: 'hi' }] };
  lifesaver.onRequest({ payload, ctx });
  assert.strictEqual(ctx.dirty, true);
  assert.match(payload.messages[0].content, /CRITICAL worker dead/);
  assert.match(payload.messages[0].content, /child_restart_limit worker/);
  assert.doesNotMatch(payload.messages[0].content, /observed tick/);
};

module.exports.lifesaverInjectionWritesContractArtifacts = async function () {
  const { assertRealLifesaverInjection, LIFESAVER_HEARTBEAT_REL, LIFESAVER_INJECT_LOG_REL } = require('../../proxy/lifesaver_alerts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-lifesaver-contract-'));
  try {
    const ok = assertRealLifesaverInjection(root, 'test', '[ALERT] LIFESAVER - synthetic contract');
    assert.strictEqual(ok, true);
    assert.ok(fs.existsSync(path.join(root, LIFESAVER_HEARTBEAT_REL)));
    const rows = fs.readFileSync(path.join(root, LIFESAVER_INJECT_LOG_REL), 'utf8').trim().split('\n');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(JSON.parse(rows[0]).source, 'test');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};



for (const [name, fn] of Object.entries(module.exports)) test(name, fn);
