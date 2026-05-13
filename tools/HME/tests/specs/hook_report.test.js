'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { appendHookExec, readRows, summarize } = require('../../hooks/hook_report');

test('hook_report: appends JSONL hook execution rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-hook-report-'));
  const file = path.join(dir, 'hook-exec.jsonl');
  appendHookExec({ event: 'PreToolUse', script: 'pretooluse_bash.sh', exit_code: 0, duration_ms: 12 }, file);
  const rows = readRows(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, 'PreToolUse');
  assert.equal(rows[0].script, 'pretooluse_bash.sh');
  assert.equal(rows[0].duration_ms, 12);
});

test('hook_report: summarizes failures and latency', () => {
  const rows = [
    { event: 'Stop', script: 'summary_format', exit_code: 2, duration_ms: 30 },
    { event: 'Stop', script: 'summary_format', exit_code: 0, duration_ms: 10 },
    { event: 'PostToolUse', script: 'log-tool-call.sh', exit_code: 0, duration_ms: 5 },
  ];
  const summary = summarize(rows);
  const stop = summary.find((item) => item.script === 'summary_format');
  assert.equal(stop.count, 2);
  assert.equal(stop.failures, 1);
  assert.equal(stop.avg_ms, 20);
  assert.equal(stop.max_ms, 30);
});
