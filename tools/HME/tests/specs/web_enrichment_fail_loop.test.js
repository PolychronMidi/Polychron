'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function freshModule() {
  const p = require.resolve('../../proxy/middleware/15_web_enrichment');
  delete require.cache[p];
  return require(p);
}

function ctx() {
  const events = [];
  return {
    events,
    emit: (row) => events.push(row),
    hasHmeFooter: (tr, marker) => String(tr.content || '').includes(marker),
    appendToResult: (tr, text) => { tr.content = `${tr.content || ''}${text}`; },
    markDirty: () => { events.push({ event: 'dirty' }); },
  };
}

test('web_enrichment: repeated failed WebSearch gets stop-retry guidance', () => {
  const mod = freshModule();
  const c = ctx();
  const toolUse = { name: 'WebSearch', input: { query: 'site:docs.anthropic.com SessionStart source startup resume clear compact' } };
  const first = { content: 'No search results', is_error: false };
  const second = { content: 'No search results', is_error: false };
  mod.onToolResult({ toolUse, toolResult: first, ctx: c });
  assert.doesNotMatch(first.content, /WEB-FAIL-LOOP/);
  mod.onToolResult({ toolUse, toolResult: second, ctx: c });
  assert.match(second.content, /WEB-FAIL-LOOP/);
  assert.match(second.content, /Stop retrying the same web tool/);
  assert.ok(c.events.some((e) => e.event === 'web_tool_failure' && e.repeat === 2));
});

test('web_enrichment: repeated Anthropic docs failure includes User-Agent fallback', () => {
  const mod = freshModule();
  const c = ctx();
  const toolUse = { name: 'WebFetch', input: { url: 'https://docs.anthropic.com/en/docs/claude-code/hooks' } };
  mod.onToolResult({ toolUse, toolResult: { content: 'HTTPError HTTP Error 403: Forbidden' }, ctx: c });
  const second = { content: 'HTTPError HTTP Error 403: Forbidden' };
  mod.onToolResult({ toolUse, toolResult: second, ctx: c });
  assert.match(second.content, /User-Agent/);
  assert.match(second.content, /Mozilla\/5\.0/);
});

test('web_enrichment: successful web result does not warn', () => {
  const mod = freshModule();
  const c = ctx();
  const toolUse = { name: 'WebSearch', input: { query: 'Claude Code hooks' } };
  const result = { content: 'Result: https://docs.anthropic.com/en/docs/claude-code/hooks' };
  mod.onToolResult({ toolUse, toolResult: result, ctx: c });
  assert.doesNotMatch(result.content, /WEB-FAIL-LOOP/);
});
