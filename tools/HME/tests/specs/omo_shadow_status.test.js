'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluateHealth, summarize, readRows } = require('../../scripts/omo-shadow-status');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

test('OMO shadow status summarizes compact rows by phase', () => {
  const rows = [
    { phase: 'tool.execute.before', status: 'ok', decision: 'modify', duration_ms: 10 },
    { phase: 'tool.execute.before', status: 'timeout', decision: '', duration_ms: 30 },
    { phase: 'tool.execute.after', status: 'ok', decision: 'allow', duration_ms: 5 },
  ];
  const summary = summarize(rows);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.statuses, { ok: 2, timeout: 1 });
  assert.equal(summary.timeout_rate, 1 / 3);
  assert.equal(summary.error_count, 0);
  assert.equal(summary.phases['tool.execute.before'].p95_ms, 30);
  assert.deepEqual(summary.phases['tool.execute.before'].decisions, { modify: 1, none: 1 });
});

test('OMO shadow health gate reports threshold failures', () => {
  const summary = summarize([
    { phase: 'tool.execute.before', status: 'ok', decision: 'allow', duration_ms: 1200 },
    { phase: 'tool.execute.before', status: 'timeout', duration_ms: 0 },
    { phase: 'tool.execute.after', status: 'dependency_error', duration_ms: 0 },
  ]);
  const health = evaluateHealth(summary, { maxTimeoutRate: 0.2, maxErrorCount: 0, maxP95Ms: 1000 });
  assert.equal(health.healthy, false);
  assert.match(health.failures.join('\n'), /timeout_rate/);
  assert.match(health.failures.join('\n'), /error_count/);
  assert.match(health.failures.join('\n'), /tool\.execute\.before p95/);
});

test('OMO shadow status reads the requested recent limit', () => {
  const file = path.join(repoRoot, 'tmp', `omo-shadow-status-${process.pid}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ phase: 'session.start', status: 'preloaded' }),
    JSON.stringify({ phase: 'tool.execute.after', status: 'ok', decision: 'allow' }),
    '',
  ].join('\n'));
  try {
    const rows = readRows(file, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phase, 'tool.execute.after');
  } finally {
    fs.rmSync(file, { force: true });
  }
});
