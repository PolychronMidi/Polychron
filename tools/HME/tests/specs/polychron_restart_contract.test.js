'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('launcher starts OmniRoute under active mode 1 and never stale mode 6', () => {
  const launch = read('tools/HME/launcher/polychron-launch.sh');
  assert.match(launch, /_OD_START="\$\{OVERDRIVE_MODE\}"/);
  assert.match(launch, /if \[ "\$_OD_START" = "1" \]; then/);
  assert.doesNotMatch(launch, /_OD_START" = "6"|OVERDRIVE_MODE=6|MODE=6/);
  assert.match(launch, /codex-proxy-supervisor\.sh/);
  assert.match(launch, /routing_ready\.py/);
});

test('service registry enables OmniRoute only for canonical mode 1', () => {
  const cfg = JSON.parse(read('tools/HME/config/services.json'));
  const omni = cfg.services.find((svc) => svc.id === 'omniroute');
  assert.deepEqual(omni.enabled_when.in, ['1']);
  assert.match(omni.description, /OVERDRIVE_MODE=1/);
});

test('shutdown owns the same bridge services as launcher', () => {
  const shutdown = read('tools/HME/launcher/polychron-shutdown.sh');
  assert.match(shutdown, /codex-proxy-supervisor\.sh/);
  assert.match(shutdown, /for _svc in proxy proxy_a proxy_b worker llamacpp_daemon codex_proxy omniroute/);
});

test('codex proxy supervisor restarts on shared routing dependency edits', () => {
  const supervisor = read('tools/HME/hooks/direct/codex-proxy-supervisor.sh');
  for (const dep of ['codex_session_guard.js', 'start_marker.js', 'model_route_resolver.js', 'request_transform_core.js', 'codex_native_tools.js']) {
    assert.match(supervisor, new RegExp(dep.replace('.', '\\.')));
  }
});

test('proxy runtime fingerprint covers worker supervisor and launcher paths', () => {
  const fingerprint = read('tools/HME/proxy/proxy_runtime_fingerprint.js');
  assert.match(fingerprint, /EXTRA_RUNTIME_FILES/);
  assert.match(fingerprint, /proxy-supervisor\.sh/);
  assert.match(fingerprint, /polychron-launch\.sh/);
  assert.match(fingerprint, /polychron-slot-restart\.sh/);
});

test('slot preflight drives request path before draining incumbent', () => {
  const restart = read('tools/HME/launcher/polychron-slot-restart.sh');
  assert.match(restart, /_wait_ready_file "\$_probe_health" "\$_probe_pid" 20/);
  assert.match(restart, /_smoke_candidate "\$_probe_port"/);
  assert.match(restart, /x-hme-preflight-smoke/);
  assert.match(restart, /preflight smoke FAILED \(booted but request path crashed\); NOT draining incumbent/);
  assert.match(restart, /OVERDRIVE_MODE=0/);
  assert.match(restart, /_preflight_candidate \|\| \{ _mark_slot_broken "preflight_failed"; exit 1; \}/);
});

test('proxy self-quarantines request-path code faults without respawn promotion', () => {
  const proxy = read('tools/HME/proxy/hme_proxy.js');
  assert.match(proxy, /markSlotBroken/);
  assert.match(proxy, /err instanceof ReferenceError \|\| err instanceof TypeError \|\| err instanceof SyntaxError/);
  assert.match(proxy, /proxy-self-quarantine/);
  assert.match(proxy, /process\.on\('unhandledRejection'/);
  assert.match(proxy, /process\.on\('uncaughtException'/);
  assert.match(proxy, /do not exit/);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function postSmoke(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/v1/messages',
      method: 'POST',
      timeout: 800,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer hme-preflight',
        'anthropic-version': '2023-06-01',
        'x-hme-preflight-smoke': '1',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ok: true, status: res.statusCode }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 16, messages: [{ role: 'user', content: 'word '.repeat(200000) }] }));
  });
}

test('functional preflight smoke rejects bootable request-path-crashed candidate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-preflight-crash-'));
  const script = path.join(root, 'candidate.js');
  const health = path.join(root, 'candidate.health');
  const port = await freePort();
  fs.writeFileSync(script, `
'use strict';
const fs = require('fs');
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  missingRequestPathSymbol();
  res.end('unreachable');
});
server.listen(${port}, '127.0.0.1', () => {
  fs.writeFileSync(${JSON.stringify(health)}, JSON.stringify({ ready: true, pid: process.pid }));
});
`);
  const child = require('child_process').spawn(process.execPath, [script], { stdio: 'ignore' });
  try {
    const deadline = Date.now() + 2000;
    while (!fs.existsSync(health) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(fs.existsSync(health), 'candidate booted and wrote ready health');
    await assert.rejects(postSmoke(port), /socket hang up|ECONNRESET|timeout/);
    assert.equal(fs.existsSync(path.join(root, 'incumbent.drain.flag')), false, 'smoke failure happens before any drain flag');
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
