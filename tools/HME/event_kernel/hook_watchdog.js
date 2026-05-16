'use strict';

const fs = require('fs');
const path = require('path');

const BUDGETS = {
  SessionStart: { client_timeout_ms: 15_000, target_ms: 3_000, warn_ms: 5_000, fail_ms: 10_000 },
  UserPromptSubmit: { client_timeout_ms: 15_000, target_ms: 1_000, warn_ms: 3_000, fail_ms: 8_000 },
  PreToolUse: { client_timeout_ms: 15_000, target_ms: 300, warn_ms: 1_000, fail_ms: 3_000 },
  PostToolUse: { client_timeout_ms: 15_000, target_ms: 500, warn_ms: 2_000, fail_ms: 6_000 },
  PreCompact: { client_timeout_ms: 15_000, target_ms: 2_000, warn_ms: 5_000, fail_ms: 10_000 },
  PostCompact: { client_timeout_ms: 15_000, target_ms: 2_000, warn_ms: 5_000, fail_ms: 10_000 },
  Stop: { client_timeout_ms: 60_000, target_ms: 5_000, warn_ms: 20_000, fail_ms: 45_000 },
};

function budgetFor(event) {
  return BUDGETS[event] || { client_timeout_ms: 15_000, target_ms: 1_000, warn_ms: 5_000, fail_ms: 10_000 };
}

function runtimeDir(root) {
  return path.join(root, 'tools', 'HME', 'runtime');
}

function paths(root) {
  const dir = runtimeDir(root);
  return {
    dir,
    state: path.join(dir, 'hook-watchdog-state.json'),
    log: path.join(dir, 'hook-watchdog.jsonl'),
    errors: path.join(root, 'log', 'hme-errors.log'),
  };
}

function parse(raw) {
  try { return JSON.parse(raw || '{}'); } catch (_e) { return {}; }
}

function sessionId(payload) {
  return payload.session_id || payload.thread_id || payload.conversation_id || '';
}

function readState(root) {
  let state;
  try { state = JSON.parse(fs.readFileSync(paths(root).state, 'utf8')); }
  catch (_e) { state = {}; }
  state.invocations = state.invocations || {};
  state.latest = state.latest || {};
  state.success = state.success || {};
  state.alerted = state.alerted || {};
  state.activity = state.activity || {};
  return state;
}

function writeState(root, state) {
  const p = paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  const tmp = `${p.state}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(prune(state)));
  fs.renameSync(tmp, p.state);
}

function prune(state) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, row] of Object.entries(state.invocations || {})) {
    if ((row.started_ms || 0) < cutoff) delete state.invocations[id];
  }
  return state;
}

function append(root, row) {
  const p = paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.log, `${JSON.stringify(row)}\n`);
}

function appendError(root, text) {
  const p = paths(root);
  fs.mkdirSync(path.dirname(p.errors), { recursive: true });
  fs.appendFileSync(p.errors, `[${new Date().toISOString()}] ${text}\n`);
}

function begin(root, event, body, fields = {}) {
  const payload = parse(body);
  const sid = sessionId(payload);
  const now = Date.now();
  const id = `${now}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const b = budgetFor(event);
  const row = {
    phase: 'begin',
    id,
    event,
    host: fields.host || payload._hme_host || '',
    session_id: sid,
    pid: process.pid,
    started_ms: now,
    ts: new Date(now).toISOString(),
    deadline_ms: fields.clientTimeoutMs || b.client_timeout_ms,
    warn_ms: b.warn_ms,
    target_ms: b.target_ms,
  };
  if (event === 'SessionStart') {
    const state = readState(root);
    state.invocations[id] = row;
    state.latest[`${event}:${sid || '-'}`] = id;
    writeState(root, state);
  }
  append(root, row);
  return { root, id, event, session_id: sid, started_ms: now };
}

function end(token, result = {}) {
  if (!token || !token.root || !token.id) return;
  const now = Date.now();
  if (token.event !== 'SessionStart') {
    const exitCode = Number.isInteger(result.exit_code) ? result.exit_code : 0;
    append(token.root, {
      phase: 'end',
      id: token.id,
      event: token.event,
      session_id: token.session_id || '',
      ended_ms: now,
      duration_ms: now - (token.started_ms || now),
      exit_code: exitCode,
    });
    if (exitCode === 0 && token.session_id) {
      const state = readState(token.root);
      state.activity[token.session_id] = { id: token.id, event: token.event, ended_ms: now };
      writeState(token.root, state);
    }
    return;
  }
  const state = readState(token.root);
  const row = state.invocations[token.id] || { id: token.id, event: token.event };
  row.phase = 'end';
  row.ended_ms = now;
  row.duration_ms = now - (row.started_ms || token.started_ms || now);
  row.exit_code = Number.isInteger(result.exit_code) ? result.exit_code : 0;
  row.stderr_preview = String(result.stderr || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  state.invocations[token.id] = row;
  if (row.event === 'SessionStart' && row.exit_code === 0) {
    state.success[row.session_id || '-'] = { id: token.id, ended_ms: now, duration_ms: row.duration_ms };
  }
  writeState(token.root, state);
  append(token.root, row);
}

function _markAlerted(root, state, key, text) {
  if (state.alerted[key]) return '';
  state.alerted[key] = Date.now();
  writeState(root, state);
  appendError(root, `[hook-watchdog] ${text.replace(/\n/g, ' | ')}`);
  return text;
}

function userPromptAlert(root, body) {
  const sid = sessionId(parse(body));
  if (!sid) return '';
  const state = readState(root);
  const latestId = state.latest[`SessionStart:${sid}`];
  const latest = latestId ? state.invocations[latestId] : null;
  const success = state.success[sid];
  const activity = state.activity[sid];
  const now = Date.now();
  if (latest && latest.phase !== 'end') {
    const age = now - (latest.started_ms || now);
    if (age > (latest.deadline_ms || budgetFor('SessionStart').client_timeout_ms)) {
      return _markAlerted(root, state, `stale:${latest.id}`,
        `[ALERT] Previous SessionStart likely timed out after ${latest.deadline_ms || 15000}ms.\n`
        + `Session: ${sid}\nStarted: ${latest.ts}\nNo matching end marker was recorded.`);
    }
  }
  if (latest && latest.phase === 'end' && latest.exit_code !== 0) {
    return _markAlerted(root, state, `nonzero:${latest.id}`,
      `[ALERT] Previous SessionStart exited ${latest.exit_code} before this prompt.\nSession: ${sid}`);
  }
  if (!success && !latest) {
    return _markAlerted(root, state, `missing:${sid}`,
      `[ALERT] UserPromptSubmit fired before successful SessionStart.\nSession: ${sid}`);
  }
  return '';
}

function hookContext(event, text) {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
    systemMessage: text,
  });
}

function main() {
  const cmd = process.argv[2] || '';
  let input = '';
  process.stdin.on('data', (c) => { input += c.toString('utf8'); });
  process.stdin.on('end', () => {
    const root = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
    if (cmd === 'userprompt-alert') {
      const alert = userPromptAlert(root, input || '{}');
      if (alert) process.stdout.write(alert);
    } else if (cmd === 'userprompt-context') {
      const alert = userPromptAlert(root, input || '{}');
      if (alert) process.stdout.write(hookContext('UserPromptSubmit', alert));
    }
  });
}

if (require.main === module) main();

module.exports = { BUDGETS, begin, budgetFor, end, hookContext, readState, userPromptAlert };
