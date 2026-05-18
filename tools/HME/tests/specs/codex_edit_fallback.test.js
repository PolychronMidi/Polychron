'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { rewriteCodexResponseObject } = require('../../proxy/codex_native_tools');

function _editCall(args) {
  return {
    type: 'function_call',
    name: 'Edit',
    arguments: JSON.stringify(args),
  };
}

test('codex Edit fallback: missing old_string/new_string rewrites to Read bridge', () => {
  const obj = _editCall({ file_path: '/abs/x.js' });
  const { body, stats } = rewriteCodexResponseObject(obj);
  assert.equal(stats.edit_fallback_to_read, 1);
  assert.equal(body.name, 'exec_command');
  const cmdArgs = JSON.parse(body.arguments);
  assert.match(cmdArgs.cmd, /codex_structured_tool\.js read/);
  assert.match(cmdArgs.cmd, /file_path/);
  assert.match(cmdArgs.cmd, /\/abs\/x\.js/);
});

test('codex Edit fallback: no-op (old===new) rewrites to Read bridge', () => {
  const obj = _editCall({ file_path: '/abs/x.js', old_string: 'same', new_string: 'same' });
  const { body, stats } = rewriteCodexResponseObject(obj);
  assert.equal(stats.edit_fallback_to_read, 1);
  assert.match(JSON.parse(body.arguments).cmd, /codex_structured_tool\.js read/);
});

test('codex Edit fallback: display-redacted old_string rewrites to Read bridge', () => {
  const redacted = '<' + 'display-redacted' + '>';
  const obj = _editCall({ file_path: '/abs/x.js', old_string: `head ${redacted} tail`, new_string: 'q' });
  const { body, stats } = rewriteCodexResponseObject(obj);
  assert.equal(stats.edit_fallback_to_read, 1);
  assert.match(JSON.parse(body.arguments).cmd, /codex_structured_tool\.js read/);
});

test('codex Edit fallback: valid Edit passes through as Edit bridge', () => {
  const obj = _editCall({ file_path: '/abs/x.js', old_string: 'old', new_string: 'new' });
  const { body, stats } = rewriteCodexResponseObject(obj);
  assert.equal(stats.edit_fallback_to_read || 0, 0);
  assert.match(JSON.parse(body.arguments).cmd, /codex_structured_tool\.js edit/);
});
