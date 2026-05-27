'use strict';
/**
 * Test for 26_empty_result_marker.js -- verifies that empty tool_result bodies
 * get the verify-or-rerun marker appended, while non-empty results and tool
 * errors pass through untouched.
 *
 * Run: node tools/HME/proxy/middleware/test_empty_result_marker.js
 * Exit: 0 on success, 1 on assertion failure.
 */

const mw = require('./26_empty_result_marker.js');

const failures = [];
function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error(`[FAIL] ${msg}`);
  } else {
    console.log(`[pass] ${msg}`);
  }
}

function makeCtx() {
  const appends = [];
  const emits = [];
  return {
    _appends: appends,
    _emits: emits,
    appendToResult(result, text) {
      appends.push(text);
      if (typeof result.content === 'string') {
        result.content = result.content + text;
      } else if (Array.isArray(result.content)) {
        result.content.push({ type: 'text', text });
      } else {
        result.content = text;
      }
    },
    markDirty() {},
    emit(fields) { emits.push(fields); },
    hasHmeFooter(result, marker) {
      const c = result.content;
      const text = typeof c === 'string' ? c
        : (Array.isArray(c) ? c.map((x) => x.text || '').join('') : '');
      return text.includes(marker);
    },
  };
}

// Case 1: empty string content (no error) -> [SUCCESS] appended.
let r = { content: '' };
let ctx = makeCtx();
mw.onToolResult({ toolUse: { name: 'Edit' }, toolResult: r, ctx });
assert(ctx._appends.length === 1, 'empty string content triggers append');
assert(ctx._appends[0].startsWith('[SUCCESS]'), 'append carries [SUCCESS] for non-error empty body');
assert(ctx._emits.length === 1 && ctx._emits[0].event === 'empty_tool_result_marked'
       && ctx._emits[0].status === 'SUCCESS',
       'emits status=SUCCESS event');

// Case 2: whitespace-only content -> [SUCCESS] appended.
r = { content: '   \n  ' };
ctx = makeCtx();
mw.onToolResult({ toolUse: { name: 'Edit' }, toolResult: r, ctx });
assert(ctx._appends.length === 1, 'whitespace-only content triggers append');
assert(ctx._appends[0].startsWith('[SUCCESS]'), 'whitespace-only -> [SUCCESS]');

// Case 3: empty array content -> [SUCCESS] appended.
r = { content: [] };
ctx = makeCtx();
mw.onToolResult({ toolUse: { name: 'Edit' }, toolResult: r, ctx });
assert(ctx._appends.length === 1, 'empty array content triggers append');

// Case 4: non-empty content -> no append.
r = { content: 'The file has been updated successfully.' };
ctx = makeCtx();
mw.onToolResult({ toolUse: { name: 'Edit' }, toolResult: r, ctx });
assert(ctx._appends.length === 0, 'non-empty content passes through');

// Case 5: is_error=true with empty content -> [FAIL] appended.
r = { content: '', is_error: true };
ctx = makeCtx();
mw.onToolResult({ toolUse: { name: 'Edit' }, toolResult: r, ctx });
assert(ctx._appends.length === 1, 'is_error empty body gets marker');
assert(ctx._appends[0].startsWith('[FAIL]'), 'is_error empty body -> [FAIL]');
assert(ctx._emits[0].status === 'FAIL', 'emits status=FAIL for is_error');

// Case 6: idempotency -- already-marked SUCCESS result is a no-op.
r = { content: '[SUCCESS]' };
ctx = makeCtx();
mw.onToolResult({ toolUse: { name: 'Edit' }, toolResult: r, ctx });
assert(ctx._appends.length === 0, '[SUCCESS]-marked result is idempotent');

// Case 7: idempotency -- already-marked FAIL result is a no-op.
r = { content: '[FAIL] tool errored with no error message body' };
ctx = makeCtx();
mw.onToolResult({ toolUse: { name: 'Edit' }, toolResult: r, ctx });
assert(ctx._appends.length === 0, '[FAIL]-marked result is idempotent');

if (failures.length > 0) {
  console.error(`\n${failures.length} test(s) failed`);
  process.exit(1);
}
console.log(`\nall tests passed`);
process.exit(0);
