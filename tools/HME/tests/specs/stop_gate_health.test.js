'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const repo = '/home/jah/Polychron';

function clearProxyCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(repo, 'tools/HME/proxy'))) delete require.cache[k];
  }
}

test('stop reminder injects into payload.system and consumes staged file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-stop-reminder-'));
  try {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tools/HME/scripts/detectors'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools/HME/scripts/detectors/registry.json'), JSON.stringify({ detectors: [] }));
    const file = path.join(root, 'tmp', 'hme-stop-reminder.json');
    fs.writeFileSync(file, JSON.stringify({ text: 'AUTO-COMPLETENESS CHECK: continue' }));
    const prevRoot = process.env.PROJECT_ROOT;
    const prevExport = process.env.HME_PROXY_EXPORT_INTERNALS;
    const prevQuiet = process.env.HME_PROXY_QUIET_IMPORT;
    process.env.PROJECT_ROOT = root;
    process.env.HME_PROXY_EXPORT_INTERNALS = '1';
    process.env.HME_PROXY_QUIET_IMPORT = '1';
    clearProxyCache();
    const { __hmeProxyInternals } = require(path.join(repo, 'tools/HME/proxy/hme_proxy.js'));
    const payload = { messages: [{ role: 'user', content: 'next' }] };
    assert.equal(__hmeProxyInternals._injectStopReminderSystem(payload, file), true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(payload.messages[0].content, 'next');
    assert.equal(Array.isArray(payload.system), true);
    assert.match(payload.system.at(-1).text, /<system-reminder>/);
    assert.match(payload.system.at(-1).text, /HME Stop Hook Feedback/);
    assert.match(payload.system.at(-1).text, /AUTO-COMPLETENESS CHECK/);
    if (prevRoot === undefined) delete process.env.PROJECT_ROOT; else process.env.PROJECT_ROOT = prevRoot;
    if (prevExport === undefined) delete process.env.HME_PROXY_EXPORT_INTERNALS; else process.env.HME_PROXY_EXPORT_INTERNALS = prevExport;
    if (prevQuiet === undefined) delete process.env.HME_PROXY_QUIET_IMPORT; else process.env.HME_PROXY_QUIET_IMPORT = prevQuiet;
    clearProxyCache();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Claude handler serves stop-gate health route', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-stop-route-'));
  const prevRoot = process.env.PROJECT_ROOT;
  const prevQuiet = process.env.HME_PROXY_QUIET_IMPORT;
  try {
    fs.mkdirSync(path.join(root, 'tools/HME/scripts/detectors'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools/HME/scripts/detectors/registry.json'), JSON.stringify({ detectors: [] }));
    process.env.PROJECT_ROOT = root;
    process.env.HME_PROXY_QUIET_IMPORT = '1';
    clearProxyCache();
    const { createClaudeHandler } = require(path.join(repo, 'tools/HME/proxy/hme_proxy_claude.js'));
    const handle = createClaudeHandler({
      PORT: 9099,
      PROXY_VERSION: 'test',
      PROXY_GIT_SHA: 'test',
      PROXY_STARTED_AT: 'test',
      routeMetrics: {},
      recordProxyRoute() {},
      effectiveCompactThreshold() { return 250000; },
      shrinkForPassthrough() { return 0; },
      shrinkForContext() { return 0; },
      injectContextHeader() {},
      async acquireOpusSlot() { return () => {}; },
      anthropicTextSseBuffer() { return Buffer.from(''); },
      getConsecutive429s() { return 0; },
      setConsecutive429s() {},
      incConsecutive429s() { return 0; },
      getLastInputTokensRemaining() { return null; },
      setLastInputTokensRemaining() {},
      getLastInputTokensLimit() { return null; },
      setLastInputTokensLimit() {},
      setLastPayloadBytes() {},
      loadedMiddleware: [],
    });
    const req = new EventEmitter();
    req.url = '/hme/stop-gate/health';
    req.headers = {};
    const res = { statusCode: 0, headers: {}, body: '' };
    await new Promise((resolve) => {
      res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
      res.end = (body = '') => { res.body += String(body); resolve(); };
      handle(req, res);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).component, 'hme-stop-gate');
  } finally {
    if (prevRoot === undefined) delete process.env.PROJECT_ROOT; else process.env.PROJECT_ROOT = prevRoot;
    clearProxyCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
