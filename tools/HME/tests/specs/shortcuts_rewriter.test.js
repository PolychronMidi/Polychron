'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const middleware = require('../../proxy/middleware');
const shortcutsRewriter = require('../../proxy/middleware/00a_shortcuts_rewriter');

let loaded = false;
async function runShortcut(payload) {
  if (!loaded) {
    middleware.loadAll();
    loaded = true;
  }
  return middleware.runPipeline(payload, {}, 'shortcut-test');
}

test('request_shape normalizes Claude messages and Codex Responses input', () => {
  const shape = require('../../proxy/request_shape');
  const claude = { messages: [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: 'tool output' }] },
    { role: 'user', content: [{ type: 'text', text: 'n' }] },
  ] };
  const codex = { input: [{ role: 'user', content: [{ type: 'input_text', text: 'm' }] }] };
  assert.equal(shape.messageText(shape.lastRealUserMessage(claude)), 'n');
  assert.equal(shape.messageText(shape.lastRealUserMessage(codex)), 'm');
});


test('isToolResultMessage filters PURE tool-result messages but not prompts bundled with them', () => {
  const shape = require('../../proxy/request_shape');
  assert.equal(shape.isToolResultMessage({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'o' }] }), true);
  assert.equal(shape.isToolResultMessage({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'o' }, { type: 'text', text: 'c' }] }), false);
});

test('shortcuts_rewriter expands a shortcut bundled with tool_results in one user message (tool-turn regression)', async () => {
  // Catastrophic regression: Claude Code bundles tool_results + the user's new
  // prompt into ONE user message. isToolResultMessage filtered the whole message,
  const payload = { messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'tool output' },
      { type: 'text', text: 'c' },
    ] },
  ] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  const last = payload.messages[payload.messages.length - 1];
  assert.equal(last.content.find((b) => b.type === 'text').text, 'continue');
  assert.ok(last.content.some((b) => b.type === 'tool_result' && b.content === 'tool output'), 'tool_result untouched');
});

test('shortcuts_rewriter expands bare n string content', async () => {
  const payload = { messages: [{ role: 'user', content: 'n' }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content, 'next suggestions?');
});

test('shortcuts_rewriter expands n after system reminder in string content', async () => {
  const reminder = '<system-reminder>noise</system-reminder>';
  const payload = { messages: [{ role: 'user', content: `${reminder}\nn` }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content, `${reminder}\nnext suggestions?`);
});

test('shortcuts_rewriter expands shortcut on last real user message before tool results', async () => {
  const payload = {
    messages: [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>noise</system-reminder>' }, { type: 'text', text: 'n' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_shortcut_probe', name: 'Bash', input: { command: 'printf probe' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_shortcut_probe', content: 'probe output' }] },
    ],
  };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content[1].text, 'next suggestions?');
  assert.equal(payload.messages[2].content[0].content, 'probe output');
});


test('shortcuts_rewriter expands Codex input_text shortcuts through shared request shape', () => {
  const payload = { input: [{ role: 'user', content: [{ type: 'input_text', text: 'm' }] }] };
  assert.doesNotThrow(() => shortcutsRewriter.onRequest({ payload, ctx: {} }));
  assert.equal(payload.input[0].content[0].text, "what's missing?");
});


test('shortcuts_rewriter expands last non-reminder text block', async () => {
  const payload = {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>noise</system-reminder>' },
        { type: 'text', text: 'n' },
      ],
    }],
  };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content[1].text, 'next suggestions?');
});

test('shortcuts_rewriter expands n when reminder follows shortcut in string content', async () => {
  const reminder = '<system-reminder>noise</system-reminder>';
  const payload = { messages: [{ role: 'user', content: `n\n${reminder}` }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content, `${reminder}\nnext suggestions?`);
  assert.doesNotMatch(payload.messages[0].content, /(^|\n)\s*n\s*(\n|$)/i);
});

test('shortcuts_rewriter expands uppercase shortcut before upstream', async () => {
  const payload = { messages: [{ role: 'user', content: 'N' }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content, 'next suggestions?');
});

test('shortcuts_rewriter expands r restart-continuation shortcut', async () => {
  const payload = { messages: [{ role: 'user', content: 'r' }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content, 'restarted. continue');
});

test('shortcuts_rewriter expands c at end of system-reminder string', async () => {
  const reminder = '<system-reminder>noise</system-reminder>';
  const payload = { messages: [{ role: 'user', content: `${reminder}\nc` }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content, `${reminder}\ncontinue`);
});

test('SHORTCUT_RE is derived from SHORTCUTS -- no drift (every map key matches)', () => {
  const { SHORTCUTS, SHORTCUT_RE } = shortcutsRewriter;
  for (const key of Object.keys(SHORTCUTS)) {
    assert.match(key, SHORTCUT_RE, `map key ${key} must match SHORTCUT_RE`);
  }
});

test('r shortcut with a trailing system-reminder preserves the reminder (drift regression)', async () => {
  const reminder = '<system-reminder>noise</system-reminder>';
  const payload = { messages: [{ role: 'user', content: `${reminder}\nr` }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  // Before the fix, r fell through to "return value" and nuked the reminder.
  assert.equal(payload.messages[0].content, `${reminder}\nrestarted. continue`);
});

test('shortcuts_rewriter tolerates middleware contexts without markDirty', () => {
  const payload = { messages: [{ role: 'user', content: 'n' }] };
  assert.doesNotThrow(() => shortcutsRewriter.onRequest({ payload, ctx: {} }));
  assert.equal(payload.messages[0].content, 'next suggestions?');
});

test('shortcuts_rewriter tolerates compact shortcut contexts without markDirty', () => {
  const payload = { messages: [{ role: 'user', content: 'cc' }] };
  assert.doesNotThrow(() => shortcutsRewriter.onRequest({ payload, ctx: {} }));
  assert.equal(payload.__shortcut_compact, true);
  assert.equal(payload.messages[0].content, '/compact');
});
