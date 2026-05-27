#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { RUNTIME_DIR } = require('../proxy/shared');

function parseArgs(argv) {
  const args = {
    limit: 200,
    json: false,
    failOnUnhealthy: false,
    maxTimeoutRate: 0,
    maxErrorCount: 0,
    maxP95Ms: 0,
    file: path.join(RUNTIME_DIR, 'omo-shadow-decisions.jsonl'),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--fail-on-unhealthy') args.failOnUnhealthy = true;
    else if (arg === '--file') args.file = argv[++i];
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg === '--max-timeout-rate') args.maxTimeoutRate = Number(argv[++i]);
    else if (arg === '--max-error-count') args.maxErrorCount = Number(argv[++i]);
    else if (arg === '--max-p95-ms') args.maxP95Ms = Number(argv[++i]);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 200;
  if (!Number.isFinite(args.maxTimeoutRate) || args.maxTimeoutRate < 0) args.maxTimeoutRate = 0;
  if (!Number.isFinite(args.maxErrorCount) || args.maxErrorCount < 0) args.maxErrorCount = 0;
  if (!Number.isFinite(args.maxP95Ms) || args.maxP95Ms < 0) args.maxP95Ms = 0;
  return args;
}

function readRows(file, limit) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try { return JSON.parse(line); }
    catch (_err) { return null; }
  }).filter(Boolean);
}

function inc(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(rows) {
  const summary = { total: rows.length, statuses: {}, phases: {}, timeout_rate: 0, error_count: 0 };
  for (const row of rows) {
    const status = row.status || 'unknown';
    const phase = row.phase || 'unknown';
    const decision = row.decision || 'none';
    inc(summary.statuses, status);
    if (!summary.phases[phase]) summary.phases[phase] = { total: 0, statuses: {}, decisions: {}, durations: [] };
    const bucket = summary.phases[phase];
    bucket.total += 1;
    inc(bucket.statuses, status);
    inc(bucket.decisions, decision);
    if (Number.isFinite(row.duration_ms) && row.duration_ms > 0) bucket.durations.push(row.duration_ms);
  }
  summary.timeout_rate = summary.total > 0 ? (summary.statuses.timeout || 0) / summary.total : 0;
  summary.error_count = ['dependency_error', 'load_error', 'error', 'invalid_event']
    .reduce((total, status) => total + (summary.statuses[status] || 0), 0);
  for (const bucket of Object.values(summary.phases)) {
    bucket.p50_ms = percentile(bucket.durations, 50);
    bucket.p95_ms = percentile(bucket.durations, 95);
    delete bucket.durations;
  }
  return summary;
}

function evaluateHealth(summary, thresholds = {}) {
  const failures = [];
  if (thresholds.maxTimeoutRate > 0 && summary.timeout_rate > thresholds.maxTimeoutRate) {
    failures.push(`timeout_rate ${summary.timeout_rate.toFixed(4)} > ${thresholds.maxTimeoutRate}`);
  }
  if (Number.isFinite(thresholds.maxErrorCount) && summary.error_count > thresholds.maxErrorCount) {
    failures.push(`error_count ${summary.error_count} > ${thresholds.maxErrorCount}`);
  }
  if (thresholds.maxP95Ms > 0) {
    for (const [phase, bucket] of Object.entries(summary.phases)) {
      if (bucket.p95_ms > thresholds.maxP95Ms) failures.push(`${phase} p95 ${bucket.p95_ms}ms > ${thresholds.maxP95Ms}ms`);
    }
  }
  return { healthy: failures.length === 0, failures };
}

function printText(summary, file) {
  console.log(`OMO shadow status: ${summary.total} recent row(s)`);
  console.log(`file: ${file}`);
  console.log(`statuses: ${JSON.stringify(summary.statuses)}`);
  console.log(`timeout_rate: ${summary.timeout_rate.toFixed(4)}`);
  console.log(`error_count: ${summary.error_count}`);
  for (const [phase, bucket] of Object.entries(summary.phases).sort()) {
    console.log(`${phase}: total=${bucket.total} p50=${bucket.p50_ms}ms p95=${bucket.p95_ms}ms statuses=${JSON.stringify(bucket.statuses)} decisions=${JSON.stringify(bucket.decisions)}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const summary = summarize(readRows(args.file, args.limit));
  const health = evaluateHealth(summary, args);
  const output = { ...summary, health };
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    printText(summary, args.file);
    if (!health.healthy) console.error(`unhealthy: ${health.failures.join('; ')}`);
  }
  if (args.failOnUnhealthy && !health.healthy) process.exit(2);
}

if (require.main === module) main();

module.exports = { evaluateHealth, parseArgs, readRows, summarize };
