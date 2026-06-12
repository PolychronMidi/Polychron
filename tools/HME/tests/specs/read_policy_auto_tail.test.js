'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluateReadInput, toHookResponse } = require('../../proxy/read_policy');

function sandbox(rel, lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-policy-tail-'));
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Array.from({ length: lines }, (_, i) => `row${i}`).join('\n') + '\n');
  return { root, file };
}

test('Read with limit and no offset on a .jsonl auto-rewrites to tail offset', () => {
  const { root, file } = sandbox('log/sample.jsonl', 1000);
  try {
    const result = evaluateReadInput({ file_path: file, limit: 40 }, { projectRoot: root, verifyLanded: false });
    assert.equal(result.decision, 'allow');
    assert.equal(result.changed, true);
    assert.equal(result.input.offset, 960, 'offset = total_lines - limit');
    assert.equal(result.input.limit, 40);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Read of a .log file under log/ auto-tails', () => {
  const { root, file } = sandbox('log/hme-proxy.out', 500);
  try {
    const result = evaluateReadInput({ file_path: file, limit: 100 }, { projectRoot: root, verifyLanded: false });
    assert.equal(result.changed, true);
    assert.equal(result.input.offset, 400);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Read of a .py source file is NOT auto-tailed', () => {
  const { root, file } = sandbox('src/module.py', 500);
  try {
    const result = evaluateReadInput({ file_path: file, limit: 40 }, { projectRoot: root, verifyLanded: false });
    assert.notEqual(result.changed, true, 'source code is not time-ordered');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('explicit offset on a time-ordered file is left alone', () => {
  const { root, file } = sandbox('log/foo.jsonl', 1000);
  try {
    const result = evaluateReadInput({ file_path: file, limit: 40, offset: 100 }, { projectRoot: root, verifyLanded: false });
    assert.notEqual(result.changed, true, 'caller intent honored');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('small time-ordered file (lines <= limit) is not rewritten', () => {
  const { root, file } = sandbox('log/small.jsonl', 20);
  try {
    const result = evaluateReadInput({ file_path: file, limit: 100 }, { projectRoot: root, verifyLanded: false });
    assert.notEqual(result.changed, true, 'no rewrite when limit captures whole file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Read without limit on a time-ordered file is left alone (caller wants whole file)', () => {
  const { root, file } = sandbox('log/foo.jsonl', 1000);
  try {
    const result = evaluateReadInput({ file_path: file }, { projectRoot: root, verifyLanded: false });
    assert.notEqual(result.changed, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runtime state json under tools/HME/runtime/ is treated as time-ordered', () => {
  const { root, file } = sandbox('tools/HME/runtime/spiralling-petulance-state.json', 600);
  try {
    const result = evaluateReadInput({ file_path: file, limit: 50 }, { projectRoot: root, verifyLanded: false });
    assert.equal(result.changed, true);
    assert.equal(result.input.offset, 550);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('toHookResponse emits updatedInput when changed', () => {
  const result = { decision: 'allow', changed: true, input: { file_path: '/foo.jsonl', limit: 40, offset: 960 }, reason: 'auto-tail' };
  const out = JSON.parse(toHookResponse(result));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(out.hookSpecificOutput.updatedInput, result.input);
  assert.equal(out.hookSpecificOutput.additionalContext, 'auto-tail');
});
