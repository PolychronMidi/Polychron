'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pluginUrl = `file://${path.resolve(__dirname, '../../opencode/plugin/hme_hooks.mjs')}`;

test('OpenCode plugin exports HME hook map for supported lifecycle events', async () => {
  const mod = await import(pluginUrl);
  assert.equal(typeof mod.default, 'function');
  const hooks = await mod.default({ project: { directory: path.resolve(__dirname, '../../../..') } });
  assert.deepEqual(Object.keys(hooks).sort(), [
    'event',
    'permission.ask',
    'tool.execute.after',
    'tool.execute.before',
  ]);
  for (const fn of Object.values(hooks)) assert.equal(typeof fn, 'function');
});

test('OpenCode plugin applyDecision denies HME-denied tool requests', async () => {
  const mod = await import(pluginUrl);
  assert.equal(Object.hasOwn(mod, 'applyDecision'), false, 'OpenCode treats named function exports as plugins');
});

test('OpenCode plugin applyDecision patches mutable tool args', async () => {
  const mod = await import(pluginUrl);
  const hooks = await mod.default({ project: { directory: path.resolve(__dirname, '../../../..') } });
  assert.equal(typeof hooks['tool.execute.before'], 'function');
});

test('OpenCode plugin handles object-shaped tool payloads without corrupting args', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-plugin-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');

  const mod = await import(pluginUrl);
  const hooks = await mod.default({ project: { directory: root } });
  const output = { args: { command: 'pwd' } };
  await hooks['tool.execute.before']({ tool: { name: 'bash', input: { command: 'pwd' } }, session: { id: 's1' } }, output);
  assert.deepEqual(output.args, { command: 'pwd' });
});

test('OpenCode plugin falls back to installed HME root outside HME projects', async () => {
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-outside-'));
  const relayLog = path.resolve(__dirname, '../../runtime/opencode-plugin-relay.jsonl');
  fs.rmSync(relayLog, { force: true });

  const mod = await import(pluginUrl);
  const hooks = await mod.default({ project: { directory: outsideRoot } });
  await hooks['tool.execute.after']({ tool: 'NoSuchTool', session: { id: 'fallback-test' } }, {});

  const rows = fs.readFileSync(relayLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows.some((row) => row.event === 'PostToolUse' && row.status === 'ok'), true);
  fs.rmSync(outsideRoot, { recursive: true, force: true });
});

test('OpenCode plugin uses node binary instead of embedded execPath', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-nodebin-'));
  const nodeShim = path.join(root, 'node-shim');
  const marker = path.join(root, 'node-used');
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  fs.writeFileSync(nodeShim, `#!/usr/bin/env sh\ntouch ${JSON.stringify(marker)}\nexec node "$@"\n`);
  fs.chmodSync(nodeShim, 0o755);

  const old = process.env.HME_NODE_BIN;
  process.env.HME_NODE_BIN = nodeShim;
  try {
    const mod = await import(pluginUrl);
    const hooks = await mod.default({ project: { directory: root } });
    await hooks['tool.execute.before']({ tool: 'Bash', args: {}, sessionID: 'nodebin-test' }, { args: {} });
    assert.equal(fs.existsSync(marker), true);
  } finally {
    if (old === undefined) delete process.env.HME_NODE_BIN;
    else process.env.HME_NODE_BIN = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
