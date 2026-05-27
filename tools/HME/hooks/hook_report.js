#!/usr/bin/env node
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = _hmeRequireEnv('PROJECT_ROOT');
const LOG_FILE = path.join(PROJECT_ROOT, 'log', 'hme-hook-exec.jsonl');

function _safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function appendHookExec(row, logFile = LOG_FILE) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const clean = {
      ts: row.ts || new Date().toISOString(),
      event: String(row.event || 'hook'),
      script: String(row.script || 'unknown'),
      cwd: String(row.cwd || ''),
      session_id: String(row.session_id || ''),
      exit_code: _safeInt(row.exit_code),
      duration_ms: _safeInt(row.duration_ms),
      stdout_bytes: _safeInt(row.stdout_bytes),
      stderr_bytes: _safeInt(row.stderr_bytes),
    };
    fs.appendFileSync(logFile, `${JSON.stringify(clean)}\n`);
    const lines = fs.readFileSync(logFile, 'utf8').split('\n');
    if (lines.length > 20001) {
      fs.writeFileSync(logFile, `${lines.slice(-10001).join('\n')}`);
    }
  } catch (_) {
    // silent-ok: optional fallback path.
    // Hook telemetry must not block hook execution.
  }
}

function readRows(logFile = LOG_FILE) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    })
    .filter(Boolean);
}

function summarize(rows) {
  const byScript = new Map();
  for (const row of rows) {
    const key = `${row.event}:${row.script}`;
    const item = byScript.get(key) || {
      event: row.event,
      script: row.script,
      count: 0,
      failures: 0,
      total_ms: 0,
      max_ms: 0,
    };
    item.count += 1;
    if (_safeInt(row.exit_code) !== 0) item.failures += 1;
    item.total_ms += _safeInt(row.duration_ms);
    item.max_ms = Math.max(item.max_ms, _safeInt(row.duration_ms));
    byScript.set(key, item);
  }
  return Array.from(byScript.values()).map((item) => ({
    ...item,
    avg_ms: item.count ? Math.round(item.total_ms / item.count) : 0,
  })).sort((a, b) => b.failures - a.failures || b.max_ms - a.max_ms || a.script.localeCompare(b.script));
}

function printTable(items) {
  console.log('event\tscript\tcount\tfail\tavg_ms\tmax_ms');
  for (const item of items) {
    console.log(`${item.event}\t${item.script}\t${item.count}\t${item.failures}\t${item.avg_ms}\t${item.max_ms}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const rows = readRows();
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ log_file: LOG_FILE, rows: rows.length, summary: summarize(rows) }, null, 2));
    return;
  }
  if (argv.includes('--clear')) {
    fs.writeFileSync(LOG_FILE, '');
    console.log(`cleared ${LOG_FILE}`);
    return;
  }
  printTable(summarize(rows));
}

if (require.main === module) main();

module.exports = { appendHookExec, readRows, summarize, LOG_FILE };
