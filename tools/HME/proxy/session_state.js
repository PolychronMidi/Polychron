'use strict';
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, RUNTIME_DIR } = require('./shared');

const STATE_FILE = path.join(RUNTIME_DIR, 'session-state.json');
const LEGACY_STATE_FILE = path.join(PROJECT_ROOT, 'tools', 'HME', 'session-state.json');
const LOCK_DIR = `${STATE_FILE}.lock`;
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;
const MAX_EVENTS = 200;
const MAX_WRITES = 200;
const MAX_EVIDENCE = 200;

function nowIso() { return new Date().toISOString(); }

function defaultState(sessionId = '') {
  return {
    schema_version: 1,
    session_id: sessionId || '',
    mode: 'unknown',
    current_phase: 'observe',
    approved_gates: [],
    files_written: [],
    failed_writes: [],
    files_read: [],
    verification_evidence: [],
    quality_judgments: [],
    detector_outcomes: {},
    onboarding: {},
    advisor: {},
    spec: {},
    phase_transitions: [],
    updated_at: nowIso(),
  };
}

function normalize(state, sessionId = '') {
  const base = defaultState(sessionId);
  const s = state && typeof state === 'object' ? { ...base, ...state } : base;
  s.schema_version = 1;
  if (sessionId && !s.session_id) s.session_id = sessionId;
  for (const key of ['approved_gates', 'files_written', 'failed_writes', 'files_read', 'verification_evidence', 'quality_judgments', 'phase_transitions']) {
    if (!Array.isArray(s[key])) s[key] = [];
  }
  for (const key of ['detector_outcomes', 'onboarding', 'advisor', 'spec']) {
    if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) s[key] = {};
  }
  return s;
}

function _quarantineCorruptState(err) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantine = `${STATE_FILE}.corrupt-${stamp}.${process.pid}`;
  try { fs.renameSync(STATE_FILE, quarantine); }
  catch (_e) { /* silent-ok: quarantine is best-effort; default reset still proceeds. */ }
  try {
    const log = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, `[${nowIso()}] [session_state] corrupt state quarantined: ${err.message}\n`);
  } catch (_e) { /* silent-ok: corruption log is advisory. */ }
}

function _readStateUnlocked(sessionId = '') {
  let raw;
  try {
    raw = fs.readFileSync(STATE_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return defaultState(sessionId);
    throw new Error(`session state unreadable at ${STATE_FILE}: ${err.message}`);
  }
  try {
    return normalize(JSON.parse(raw), sessionId);
  } catch (err) {
    _quarantineCorruptState(err);
    return defaultState(sessionId);
  }
}

function readState(sessionId = '') {
  return _readStateUnlocked(sessionId);
}

function _fsyncDir(dir) {
  let dfd;
  try {
    dfd = fs.openSync(dir, 'r');
    fs.fsyncSync(dfd);
  } catch (_e) {
    // silent-ok: directory fsync is best-effort (some platforms/filesystems disallow it)
  } finally {
    if (dfd !== undefined) fs.closeSync(dfd);
  }
}

function _writeFileDurableAtomic(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  _fsyncDir(dir);
}

function writeState(state) {
  const s = normalize(state);
  s.updated_at = nowIso();
  const text = JSON.stringify(s, null, 2);
  // Mesh-found P1/P2 (session-state review): crash-DURABLE atomic writes for the
  // canonical state file AND the legacy mirror; no torn full-file mirror writes.
  _writeFileDurableAtomic(STATE_FILE, text);
  try { _writeFileDurableAtomic(LEGACY_STATE_FILE, text); } catch (_e) { /* silent-ok: legacy mirror is best-effort. */ }
  return s;
}

function _sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function _isStaleLock() {
  try {
    const st = fs.statSync(LOCK_DIR);
    return Date.now() - st.mtimeMs > LOCK_STALE_MS;
  } catch (_e) { return false; }
}

function _acquireLock() {
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(LOCK_DIR, { mode: 0o700 });
      try { fs.writeFileSync(path.join(LOCK_DIR, 'owner'), `${process.pid} ${nowIso()}\n`); }
      catch (_e) { /* silent-ok: owner file is diagnostic only. */ }
      return () => { try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch (_e) { /* silent-ok: lock cleanup best-effort. */ } };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      if (_isStaleLock()) {
        try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); }
        catch (_e) { /* silent-ok: another process may remove stale lock first. */ }
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`session_state lock timeout at ${LOCK_DIR}`);
      _sleepMs(25);
    }
  }
}

function update(mutator, sessionId = '') {
  const release = _acquireLock();
  try {
    const s = _readStateUnlocked(sessionId);
    const next = mutator(s) || s;
    return writeState(next);
  } finally {
    release();
  }
}

function _pushBounded(arr, item, max) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function recordPhase(phase, meta = {}) {
  const clean = String(phase || '').trim().toLowerCase();
  if (!clean) return readState(meta.session_id || '');
  return update((s) => {
    if (s.current_phase !== clean) {
      _pushBounded(s.phase_transitions, { ts: nowIso(), from: s.current_phase, to: clean, ...meta }, MAX_EVENTS);
    }
    s.current_phase = clean;
    if (meta.mode) s.mode = meta.mode;
  }, meta.session_id || '');
}

function recordWrite(payload = {}, decision = {}) {
  return update((s) => {
    const entry = {
      ts: nowIso(),
      session_id: payload.session_id || s.session_id || '',
      tool: payload.tool_name || '',
      file: payload.tool_input && payload.tool_input.file_path || '',
      decision: decision.permissionDecision || decision.decision || 'allow',
      reason: decision.reason || '',
    };
    if (entry.decision === 'deny') _pushBounded(s.failed_writes, entry, MAX_WRITES);
    else _pushBounded(s.files_written, entry, MAX_WRITES);
  }, payload.session_id || '');
}

function recordRead(payload = {}, meta = {}) {
  return update((s) => {
    const input = payload.tool_input || payload.input || {};
    const entry = {
      ts: nowIso(),
      session_id: payload.session_id || meta.session_id || s.session_id || '',
      tool: payload.tool_name || meta.tool || 'Read',
      file: input.file_path || payload.file_path || meta.file || '',
      source: meta.source || 'native',
      reason: meta.reason || '',
    };
    _pushBounded(s.files_read, entry, MAX_WRITES);
  }, payload.session_id || meta.session_id || '');
}

function recordDetectorOutcome(name, verdict, meta = {}) {
  if (!name) return readState(meta.session_id || '');
  return update((s) => {
    s.detector_outcomes[name] = { verdict: verdict || 'unknown', ts: nowIso(), ...meta };
  }, meta.session_id || '');
}

function recordVerificationEvidence(ev = {}) {
  return update((s) => {
    _pushBounded(s.verification_evidence, {
      ts: nowIso(),
      session_id: ev.session_id || s.session_id || '',
      item: ev.item || '',
      command: ev.command || '',
      exit_code: Number.isInteger(ev.exit_code) ? ev.exit_code : null,
      excerpt: ev.excerpt || '',
      artifact: ev.artifact || '',
      source: ev.source || 'unknown',
    }, MAX_EVIDENCE);
  }, ev.session_id || '');
}

function recentVerificationEvidence(maxAgeMs = 30 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  return readState().verification_evidence.filter((ev) => {
    const t = Date.parse(ev.ts || '');
    return Number.isFinite(t) && t >= cutoff;
  });
}

module.exports = {
  STATE_FILE,
  LEGACY_STATE_FILE,
  readState,
  writeState,
  update,
  recordPhase,
  recordWrite,
  recordRead,
  recordDetectorOutcome,
  recordVerificationEvidence,
  recentVerificationEvidence,
};
