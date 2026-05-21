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

test('shortcuts_rewriter expands c at end of system-reminder string', async () => {
  const reminder = '<system-reminder>noise</system-reminder>';
  const payload = { messages: [{ role: 'user', content: `${reminder}\nc` }] };
  const dirty = await runShortcut(payload);
  assert.equal(dirty, true);
  assert.equal(payload.messages[0].content, `${reminder}\ncontinue`);
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
