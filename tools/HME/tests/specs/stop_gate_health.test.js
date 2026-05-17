'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
    process.env.PROJECT_ROOT = root;
    process.env.HME_PROXY_EXPORT_INTERNALS = '1';
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
    clearProxyCache();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
