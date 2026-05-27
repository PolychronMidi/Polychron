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
    'chat.headers',
    'chat.message',
    'chat.params',
    'command.execute.before',
    'event',
    'experimental.chat.messages.transform',
    'experimental.chat.system.transform',
    'experimental.compaction.autocontinue',
    'experimental.session.compacting',
    'experimental.text.complete',
    'permission.ask',
    'session.stop',
    'shell.env',
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

test('OpenCode plugin applies HME updatedInput rewrites to tool args', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-updated-input-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), [
    'const event = process.argv[process.argv.indexOf("--event") + 1];',
    'if (event === "PreToolUse") process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow", updatedInput: { command: "pwd" } } }));',
    'process.exit(0);',
    '',
  ].join('\n'));

  const mod = await import(`${pluginUrl}?updated-input-${Date.now()}`);
  const hooks = await mod.default({ project: { directory: root } });
  const output = { args: { command: 'date' } };
  await hooks['tool.execute.before']({ tool: 'Bash', sessionID: 's1' }, output);
  assert.deepEqual(output.args, { command: 'pwd' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('OpenCode plugin normalizes OpenCode tool names before HME relay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-tool-normalize-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  const capture = path.join(root, 'capture.json');
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), [
    'const fs = require("fs");',
    `fs.writeFileSync(${JSON.stringify(capture)}, fs.readFileSync(0, "utf8"));`,
    'process.exit(0);',
    '',
  ].join('\n'));

  const mod = await import(`${pluginUrl}?tool-normalize-${Date.now()}`);
  const hooks = await mod.default({ project: { directory: root } });
  await hooks['tool.execute.before']({ tool: 'apply_patch', sessionID: 's1' }, { args: { file_path: '/x.js', old_string: 'a', new_string: 'b' } });
  const payload = JSON.parse(fs.readFileSync(capture, 'utf8'));
  assert.equal(payload.tool_name, 'Edit');
  fs.rmSync(root, { recursive: true, force: true });
});

test('OpenCode plugin applies TextComplete rewrite and drop decisions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-textcomplete-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), [
    'const fs = require("node:fs");',
    'const event = process.argv[process.argv.indexOf("--event") + 1];',
    'const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");',
    'if (event === "TextComplete" && input.text === "drop") process.stdout.write(JSON.stringify({ decision: "drop" }));',
    'else if (event === "TextComplete") process.stdout.write(JSON.stringify({ decision: "modify", text: "rewritten" }));',
    'process.exit(0);',
    '',
  ].join('\n'));

  const mod = await import(`${pluginUrl}?textcomplete-${Date.now()}`);
  const hooks = await mod.default({ project: { directory: root } });
  const rewrite = { text: 'original' };
  await hooks['experimental.text.complete']({ sessionID: 's1' }, rewrite);
  assert.equal(rewrite.text, 'rewritten');
  const drop = { text: 'drop' };
  await hooks['experimental.text.complete']({ sessionID: 's1' }, drop);
  assert.equal(drop.text, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('OpenCode plugin expands prompt shortcuts before relaying UserPromptSubmit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-shortcut-'));
  const calls = path.join(root, 'calls.jsonl');
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const event = process.argv[process.argv.indexOf("--event") + 1];',
    'const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");',
    'fs.appendFileSync(path.join(process.env.PROJECT_ROOT, "calls.jsonl"), JSON.stringify({ event, input }) + "\\n");',
    'process.exit(0);',
    '',
  ].join('\n'));

  const mod = await import(`${pluginUrl}?shortcut-${Date.now()}`);
  const hooks = await mod.default({ project: { directory: root } });
  const output = { message: {}, parts: [{ type: 'text', text: 'n' }] };
  await hooks['chat.message']({ sessionID: 's1' }, output);

  assert.equal(output.parts[0].text, 'next suggestions?');
  assert.equal(output.message._hme_shortcut_expanded, true);
  const row = JSON.parse(fs.readFileSync(calls, 'utf8').trim());
  assert.equal(row.event, 'UserPromptSubmit');
  assert.equal(row.input.parts[0].text, 'next suggestions?');
  fs.rmSync(root, { recursive: true, force: true });
});

test('OpenCode plugin replaces system prompt from canonical template when enabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-system-'));
  const calls = path.join(root, 'calls.jsonl');
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.mkdirSync(path.join(root, 'doc/templates'), { recursive: true });
  fs.writeFileSync(path.join(root, '.env'), 'HME_REPLACE_SYSTEM_PROMPT=1\nHME_OPENCODE_HOOK_TOASTS=0\n');
  fs.writeFileSync(path.join(root, 'doc/templates/canonical-system-prompt.md'), 'canonical opencode prompt\n');
  fs.writeFileSync(path.join(root, 'doc/templates/AGENTS.md'), '# Rules\n\n- keep signal high\n');
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const event = process.argv[process.argv.indexOf("--event") + 1];',
    'const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");',
    'fs.appendFileSync(path.join(process.env.PROJECT_ROOT, "calls.jsonl"), JSON.stringify({ event, input }) + "\\n");',
    'process.exit(0);',
    '',
  ].join('\n'));
  const oldReplace = process.env.HME_REPLACE_SYSTEM_PROMPT;
  const oldToasts = process.env.HME_OPENCODE_HOOK_TOASTS;
  delete process.env.HME_REPLACE_SYSTEM_PROMPT;
  delete process.env.HME_OPENCODE_HOOK_TOASTS;

  try {
    const mod = await import(`${pluginUrl}?system-replace-${Date.now()}`);
    const hooks = await mod.default({ project: { directory: root } });
    const output = { system: ['opencode default prompt'] };
    await hooks['experimental.chat.system.transform']({ sessionID: 's1' }, output);
    assert.deepEqual(output.system, ['canonical opencode prompt\n\n<doc_templates_agents_md>\n# Rules\n\n- keep signal high\n</doc_templates_agents_md>']);
    const row = JSON.parse(fs.readFileSync(calls, 'utf8').trim());
    assert.equal(row.event, 'ChatSystemTransform');
    assert.deepEqual(row.input.system, ['canonical opencode prompt\n\n<doc_templates_agents_md>\n# Rules\n\n- keep signal high\n</doc_templates_agents_md>']);
  } finally {
    if (oldReplace === undefined) delete process.env.HME_REPLACE_SYSTEM_PROMPT;
    else process.env.HME_REPLACE_SYSTEM_PROMPT = oldReplace;
    if (oldToasts === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = oldToasts;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin leaves system prompt unchanged when replacement disabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-system-off-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.mkdirSync(path.join(root, 'doc/templates'), { recursive: true });
  fs.writeFileSync(path.join(root, '.env'), 'HME_REPLACE_SYSTEM_PROMPT=0\nHME_OPENCODE_HOOK_TOASTS=0\n');
  fs.writeFileSync(path.join(root, 'doc/templates/canonical-system-prompt.md'), 'canonical opencode prompt\n');
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  const oldReplace = process.env.HME_REPLACE_SYSTEM_PROMPT;
  const oldToasts = process.env.HME_OPENCODE_HOOK_TOASTS;
  delete process.env.HME_REPLACE_SYSTEM_PROMPT;
  delete process.env.HME_OPENCODE_HOOK_TOASTS;

  try {
    const mod = await import(`${pluginUrl}?system-off-${Date.now()}`);
    const hooks = await mod.default({ project: { directory: root } });
    const output = { system: ['opencode default prompt'] };
    await hooks['experimental.chat.system.transform']({ sessionID: 's1' }, output);
    assert.deepEqual(output.system, ['opencode default prompt']);
  } finally {
    if (oldReplace === undefined) delete process.env.HME_REPLACE_SYSTEM_PROMPT;
    else process.env.HME_REPLACE_SYSTEM_PROMPT = oldReplace;
    if (oldToasts === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = oldToasts;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin maps available hooks to HME lifecycle events', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-parity-'));
  const calls = path.join(root, 'calls.jsonl');
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const event = process.argv[process.argv.indexOf("--event") + 1];',
    'fs.appendFileSync(path.join(process.env.PROJECT_ROOT, "calls.jsonl"), JSON.stringify({ event }) + "\\n");',
    'process.exit(0);',
    '',
  ].join('\n'));

  const mod = await import(pluginUrl);
  const hooks = await mod.default({ project: { directory: root } });
  await hooks.event({ event: { type: 'session.created' } });
  await hooks.event({ event: { type: 'session.compacting' } });
  await hooks.event({ event: { type: 'session.compacted' } });
  await hooks.event({ event: { type: 'session.idle' } });
  await hooks['chat.message']({ sessionID: 's1' }, { message: {}, parts: [] });
  await hooks['chat.params']({ sessionID: 's1' }, { options: { temperature: 0.5 } });
  await hooks['chat.headers']({ sessionID: 's1' }, { headers: { 'x-test': '1' } });
  await hooks['command.execute.before']({ command: 'test', sessionID: 's1', arguments: '' }, { parts: [] });
  await hooks['experimental.chat.messages.transform']({ sessionID: 's1' }, { messages: [] });
  await hooks['experimental.chat.system.transform']({ sessionID: 's1' }, { system: [] });
  await hooks['experimental.session.compacting']({ sessionID: 's1' }, { context: [] });
  await hooks['experimental.compaction.autocontinue']({ sessionID: 's1' }, { enabled: true });
  await hooks['shell.env']({ sessionID: 's1', cwd: root }, { env: {} });
  await hooks['experimental.text.complete']({ sessionID: 's1', messageID: 'm1', partID: 'p1' }, { text: 'done' });
  await hooks['session.stop']({ sessionID: 's1' }, {});

  const events = fs.readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line).event);
  assert.deepEqual(events, [
    'SessionStart',
    'PreCompact',
    'PostCompact',
    'Stop',
    'UserPromptSubmit',
    'ChatParams',
    'ChatHeaders',
    'UserPromptSubmit',
    'ChatMessagesTransform',
    'ChatSystemTransform',
    'PreCompact',
    'PostCompact',
    'ShellEnv',
    'TextComplete',
    'Stop',
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('OpenCode plugin blocks session.stop on HME Stop block decision', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-stop-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), [
    'const event = process.argv[process.argv.indexOf("--event") + 1];',
    'if (event === "Stop") process.stdout.write(JSON.stringify({ decision: "block", reason: "not yet" }));',
    'process.exit(0);',
    '',
  ].join('\n'));

  const mod = await import(pluginUrl);
  const hooks = await mod.default({ project: { directory: root } });
  await assert.rejects(() => hooks['session.stop']({ sessionID: 's1' }, {}), /not yet/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('OpenCode plugin mirrors unexpected hook exceptions to hme-errors for Lifesaver', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-error-route-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  const old = process.env.HME_OPENCODE_HOOK_TOASTS;
  process.env.HME_OPENCODE_HOOK_TOASTS = 'definitely-not-bool';

  try {
    const mod = await import(`${pluginUrl}?error-route-${Date.now()}`);
    const hooks = await mod.default({ project: { directory: root } });
    await assert.rejects(() => hooks['tool.execute.before']({ tool: 'Bash', sessionID: 's1' }, { args: {} }), /invalid boolean environment key/);
    const errLog = fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8');
    assert.match(errLog, /\[opencode-plugin\] ERROR/);
    assert.match(errLog, /tool\.execute\.before/);
  } finally {
    if (old === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin mirrors OpenCode stderr errors to hme-errors for Lifesaver', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-stderr-route-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');

  const mod = await import(`${pluginUrl}?stderr-route-${Date.now()}`);
  await mod.default({ project: { directory: root } });
  process.stderr.write('Type validation error: message schema invalid while submitting\n');
  const errLog = fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8');
  assert.match(errLog, /\[opencode-stderr\] ERROR Type validation error/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('OpenCode plugin falls back to installed HME root outside HME projects', async () => {
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-outside-'));
  const relayLog = path.resolve(__dirname, '../../runtime/opencode-plugin-relay.jsonl');
  const nestedRelayLog = path.resolve(__dirname, '../../../tools/HME/runtime/opencode-plugin-relay.jsonl');
  fs.rmSync(relayLog, { force: true });
  fs.rmSync(nestedRelayLog, { force: true });

  const mod = await import(pluginUrl);
  const oldCwd = process.cwd();
  process.chdir(outsideRoot);
  try {
    const hooks = await mod.default({ project: { directory: outsideRoot } });
    await hooks['tool.execute.after']({ tool: 'NoSuchTool', session: { id: 'fallback-test' } }, {});
  } finally {
    process.chdir(oldCwd);
  }

  const rows = fs.readFileSync(relayLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows.some((row) => row.event === 'PostToolUse' && row.status === 'ok'), true);
  assert.equal(fs.existsSync(nestedRelayLog), false);
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
    const mod = await import(`${pluginUrl}?visible-toast-${Date.now()}`);
    const hooks = await mod.default({ project: { directory: root } });
    await hooks['tool.execute.before']({ tool: 'Bash', args: {}, sessionID: 'nodebin-test' }, { args: {} });
    assert.equal(fs.existsSync(marker), true);
  } finally {
    if (old === undefined) delete process.env.HME_NODE_BIN;
    else process.env.HME_NODE_BIN = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin hook toasts are opt-in', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-toasts-off-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  const calls = [];
  const old = process.env.HME_OPENCODE_HOOK_TOASTS;
  delete process.env.HME_OPENCODE_HOOK_TOASTS;

  try {
    const mod = await import(`${pluginUrl}?visible-toast-${Date.now()}`);
    const hooks = await mod.default({
      project: { directory: root },
      client: { tui: { showToast: (input) => calls.push(input) } },
    });
    await hooks['chat.params']({ sessionID: 's1' }, { options: {} });
    assert.deepEqual(calls, []);
  } finally {
    if (old === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin hook toasts can be enabled from project .env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-toasts-envfile-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  fs.writeFileSync(path.join(root, '.env'), 'HME_OPENCODE_HOOK_TOASTS=1\n');
  const calls = [];
  const old = process.env.HME_OPENCODE_HOOK_TOASTS;
  delete process.env.HME_OPENCODE_HOOK_TOASTS;

  try {
    const mod = await import(`${pluginUrl}?visible-toast-${Date.now()}`);
    const hooks = await mod.default({
      project: { directory: root },
      client: { tui: { showToast: (input) => calls.push(input) } },
    });
    await hooks['chat.params']({ sessionID: 's1' }, { options: {} });
    assert.equal(calls[0]?.body?.message, 'chat.params.callback');
  } finally {
    if (old === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin does not toast or relay-log generic event callbacks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-toasts-event-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  fs.writeFileSync(path.join(root, '.env'), 'HME_OPENCODE_HOOK_TOASTS=1\n');
  const calls = [];
  const old = process.env.HME_OPENCODE_HOOK_TOASTS;
  delete process.env.HME_OPENCODE_HOOK_TOASTS;

  try {
    const mod = await import(`${pluginUrl}?event-toast-${Date.now()}`);
    const hooks = await mod.default({
      project: { directory: root },
      client: { tui: { showToast: (input) => calls.push(input) } },
    });
    const relayLog = path.join(root, 'tools/HME/runtime/opencode-plugin-relay.jsonl');
    await hooks.event({ event: { type: 'tui.toast.show' } });
    assert.deepEqual(calls, []);
    const rows = fs.existsSync(relayLog)
      ? fs.readFileSync(relayLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
    assert.equal(rows.some((row) => row.event === 'event.callback'), false);
  } finally {
    if (old === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin rate-limits duplicate hook toasts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-toasts-rate-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  fs.writeFileSync(path.join(root, '.env'), 'HME_OPENCODE_HOOK_TOASTS=1\n');
  const calls = [];
  const old = process.env.HME_OPENCODE_HOOK_TOASTS;
  delete process.env.HME_OPENCODE_HOOK_TOASTS;

  try {
    const mod = await import(`${pluginUrl}?rate-toast-${Date.now()}`);
    const hooks = await mod.default({
      project: { directory: root },
      client: { tui: { showToast: (input) => calls.push(input) } },
    });
    await hooks['chat.params']({ sessionID: 's1' }, { options: {} });
    await hooks['chat.params']({ sessionID: 's1' }, { options: {} });
    assert.equal(calls.length, 1);
  } finally {
    if (old === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode plugin can show visible hook toasts for diagnostics', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-opencode-toasts-on-'));
  fs.mkdirSync(path.join(root, 'tools/HME/event_kernel'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/event_kernel/host_hook_entry.js'), 'process.exit(0)\n');
  const calls = [];
  const old = process.env.HME_OPENCODE_HOOK_TOASTS;
  process.env.HME_OPENCODE_HOOK_TOASTS = '1';

  try {
    const mod = await import(`${pluginUrl}?visible-toast-${Date.now()}`);
    const hooks = await mod.default({
      project: { directory: root },
      client: { tui: { showToast: (input) => calls.push(input) } },
    });
    await hooks['chat.params']({ sessionID: 's1' }, { options: {} });
    assert.deepEqual(calls, [{
      body: {
        title: 'HME hook',
        message: 'chat.params.callback',
        variant: 'info',
        duration: 1500,
      },
    }]);
  } finally {
    if (old === undefined) delete process.env.HME_OPENCODE_HOOK_TOASTS;
    else process.env.HME_OPENCODE_HOOK_TOASTS = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
