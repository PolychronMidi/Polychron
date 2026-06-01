#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { RUNTIME_DIR } = require('./shared');

function procCmd(pid) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0').filter(Boolean); }
  catch (_err) { return []; }
}

function procInfo(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ');
    const fields = stat[1].split(/\s+/);
    return { pid, state: fields[0], ppid: Number(fields[1] || 0), start: Number(fields[19] || 0), cmd: procCmd(pid) };
  } catch (_err) { return null; }
}

function sessionFromCmd(cmd) {
  const idx = cmd.indexOf('resume');
  return idx >= 0 && cmd[idx + 1] ? String(cmd[idx + 1]) : '';
}

function kindOf(cmd) {
  const joined = cmd.join(' ');
  if (/\/bin\/codex$/.test(cmd[1] || '') && cmd.includes('resume')) return 'wrapper';
  if (/\/codex\/codex$/.test(cmd[0] || '') && cmd.includes('resume')) return 'child';
  if (/vendor\/.*\/codex\/codex$/.test(cmd[0] || '') && cmd.includes('resume')) return 'child';
  if (joined.includes('/bin/codex resume ')) return 'wrapper';
  return '';
}

function scan() {
  const rows = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const info = procInfo(Number(name));
    if (!info || !info.cmd.length) continue;
    const kind = kindOf(info.cmd);
    if (!kind) continue;
    rows.push({ ...info, kind, session_id: sessionFromCmd(info.cmd), command: info.cmd.join(' ') });
  }
  rows.sort((a, b) => a.start - b.start || a.pid - b.pid);
  return rows;
}

function descendants(rows, roots) {
  const pids = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) { pids.add(row.pid); changed = true; }
    }
  }
  return [...pids].sort((a, b) => a - b);
}

function duplicatePlan(rows = scan(), onlySession = '') {
  const bySession = new Map();
  for (const row of rows) {
    if (!row.session_id || (onlySession && row.session_id !== onlySession)) continue;
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
    bySession.get(row.session_id).push(row);
  }
  const plans = [];
  for (const [sessionId, group] of bySession.entries()) {
    const wrappers = group.filter((row) => row.kind === 'wrapper');
    if (wrappers.length <= 1) continue;
    const keep = wrappers.reduce((best, row) => (row.start > best.start ? row : best), wrappers[0]);
    const stale = wrappers.filter((row) => row.pid !== keep.pid).map((row) => row.pid);
    plans.push({ session_id: sessionId, keep: keep.pid, kill: descendants(group, stale), wrappers: wrappers.map((row) => row.pid) });
  }
  return plans;
}

function killPid(pid, signal = 'SIGTERM') {
  try { process.kill(pid, signal); return true; }
  catch (_err) { return false; }
}

function reapDuplicates(opts = {}) {
  const rows = scan();
  const plans = duplicatePlan(rows, opts.sessionId || '');
  const killed = [];
  for (const plan of plans) {
    for (const pid of plan.kill) if (killPid(pid)) killed.push(pid);
  }
  return { ok: true, killed, plans, rows: scan() };
}

function safeSid(sessionId) { return String(sessionId || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96); }
function lockPath(sessionId) { return path.join(RUNTIME_DIR, `codex-session-${safeSid(sessionId)}.pid`); }

function ensureSession(sessionId) {
  if (!sessionId) return { ok: true, skipped: 'missing_session' };
  const result = reapDuplicates({ sessionId });
  const wrappers = result.rows.filter((row) => row.kind === 'wrapper' && row.session_id === sessionId);
  const keep = wrappers.reduce((best, row) => (!best || row.start > best.start ? row : best), null);
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (keep) fs.writeFileSync(lockPath(sessionId), `${keep.pid}\n`);
  return { ...result, session_id: sessionId, lock_pid: keep ? keep.pid : null, lock_file: lockPath(sessionId) };
}

function status() {
  const rows = scan();
  return { ok: true, rows, duplicates: duplicatePlan(rows) };
}

if (require.main === module) {
  const action = process.argv[2] || 'status';
  const sid = process.argv[3] || '';
  const out = action === 'reap' ? reapDuplicates({ sessionId: sid }) : action === 'ensure' ? ensureSession(sid) : status();
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

module.exports = { scan, duplicatePlan, reapDuplicates, ensureSession, status };
