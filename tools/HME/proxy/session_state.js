'use strict';
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, RUNTIME_DIR } = require('./shared');

const STATE_FILE = path.join(RUNTIME_DIR, 'session-state.json');
const LEGACY_STATE_FILE = path.join(PROJECT_ROOT, 'tools', 'HME', 'session-state.json');
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
  for (const key of ['approved_gates', 'files_written', 'failed_writes', 'verification_evidence', 'quality_judgments', 'phase_transitions']) {
    if (!Array.isArray(s[key])) s[key] = [];
  }
  for (const key of ['detector_outcomes', 'onboarding', 'advisor', 'spec']) {
    if (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key])) s[key] = {};
  }
  return s;
}

function readState(sessionId = '') {
  try {
    return normalize(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), sessionId);
  } catch (_e) {
    // silent-ok: optional fallback path.
    return defaultState(sessionId);
  }
}

function writeState(state) {
  const s = normalize(state);
  s.updated_at = nowIso();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const text = JSON.stringify(s, null, 2);
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, STATE_FILE);
  try { fs.writeFileSync(LEGACY_STATE_FILE, text); } catch (_e) { /* best-effort mirror */ }
  return s;
}

function update(mutator, sessionId = '') {
  const s = readState(sessionId);
  const next = mutator(s) || s;
  return writeState(next);
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
  recordDetectorOutcome,
  recordVerificationEvidence,
  recentVerificationEvidence,
};
