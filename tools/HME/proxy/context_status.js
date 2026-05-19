'use strict';
// Session status context (S1+S2+S3+S4). Snapshotted at most once per
// CACHE_STABLE_MS so injected text stays byte-identical inside the
// 5-min Anthropic prompt-cache window.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const hmePaths = require('./hme_paths');

const CACHE_STABLE_MS = 4 * 60 * 1000;
let _statusSnapshot = null;
let _statusSnapshotAt = 0;

const COHERENCE_BUDGET_PATH = hmePaths.hmeMetric('hme-coherence-budget.json');
const ERRORS_LOG = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
const ACTIVITY_LOG = hmePaths.hmeMetric('hme-activity.jsonl');
const GROUND_TRUTH_LOG = hmePaths.hmeMetric('hme-ground-truth.jsonl');
const DIR_INTENT_PATH = hmePaths.hmeMetric('hme-dir-intent.json');

function _dirIntentHealthLine() {
  try {
    const raw = fs.readFileSync(DIR_INTENT_PATH, 'utf8');
    const d = JSON.parse(raw);
    const c = (d && d.counts) || {};
    const parts = [];
    if (c.drifted) parts.push(`${c.drifted} drifted`);
    if (c.invalid) parts.push(`${c.invalid} invalid`);
    if (parts.length === 0) return null;
    return `dir-intent: ${parts.join(', ')} -- run build-dir-intent-index.py to investigate`;
  } catch (_err) {
    // silent-ok: optional fallback path.
    return null;
  }
}

function tailFileLines(filepath, maxLines, maxBytes = 500_000) {
  try {
    const stats = fs.statSync(filepath);
    if (stats.size === 0) return [];
    let content;
    if (stats.size > maxBytes) {
      const fd = fs.openSync(filepath, 'r');
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, stats.size - maxBytes);
      fs.closeSync(fd);
      content = buf.toString('utf8');
      const nl = content.indexOf('\n');
      if (nl > 0) content = content.slice(nl + 1);
    } else {
      content = fs.readFileSync(filepath, 'utf8');
    }
    const lines = content.split('\n').filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch (_err) {
    // silent-ok: optional fallback path.
    return [];
  }
}

function recentLifesaverErrors() {
  // Turn-aware: show only errors added since userpromptsubmit.sh recorded
  // the turn-start line count in tools/HME/runtime/errors-turnstart.
  const TURNSTART_PATH = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'errors-turnstart');
  let turnStartLine = null;
  try {
    const raw = fs.readFileSync(TURNSTART_PATH, 'utf8').trim();
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) turnStartLine = n;
  } catch (_e) { /* no turnstart yet */ }

  const lines = tailFileLines(ERRORS_LOG, 200);
  let fresh;
  if (turnStartLine !== null) {
    let totalLines = 0;
    try { totalLines = fs.readFileSync(ERRORS_LOG, 'utf8').split('\n').filter((l) => l.length > 0).length; }
    catch (_e) { /* fall through to clock cutoff */ }
    const addedSinceTurnStart = Math.max(0, totalLines - turnStartLine);
    fresh = addedSinceTurnStart > 0 ? lines.slice(-addedSinceTurnStart) : [];
  } else {
    const now = Date.now();
    const CUTOFF_MS = 30 * 60 * 1000;
    fresh = [];
    for (const line of lines) {
      const m = line.match(/^\[([^\]]+)\]/);
      if (!m) continue;
      const t = Date.parse(m[1]);
      if (Number.isNaN(t)) continue;
      if (now - t < CUTOFF_MS) fresh.push(line);
    }
  }

  // Mirror the same classification lifesaver.sh and lifesaver_inject.js
  const _CANARY_RE = /\[CANARY-/;
  const _OBSERVATION_RE = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;
  const _SELF_TAG_RE = /\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|worker:[^\]]+|hook-failure|sessionstart:[^\]]+)\]/;
  const filtered = fresh.filter((line) => {
    if (_CANARY_RE.test(line)) return false;
    if (_SELF_TAG_RE.test(line)) return false;
    if (_OBSERVATION_RE.test(line)) return false;
    return true;
  });

  return filtered.slice(-5).map((line) => {
    const m = line.match(/^\[([^\]]+)\]/);
    return m ? line.replace(/^\[[^\]]+\]/, `[${m[1].slice(0, 10)}]`) : line;
  });
}

function coherenceStatusLine() {
  try {
    const raw = fs.readFileSync(COHERENCE_BUDGET_PATH, 'utf8');
    const data = JSON.parse(raw);
    const score = data.current_coherence;
    const band = data.band;
    if (typeof score !== 'number' || !Array.isArray(band) || band.length !== 2) return null;
    let state;
    if (score < band[0]) state = 'BELOW (tighten)';
    else if (score > band[1]) state = 'ABOVE (explore)';
    else state = 'IN_BAND';
    return `coherence=${score.toFixed(3)} band=[${band[0]}, ${band[1]}] state=${state}`;
  } catch (_err) {
    // silent-ok: optional fallback path.
    return null;
  }
}

// Recency cutoffs: stale entries leak across days otherwise. Every
const ACTIVITY_MAX_AGE_MS = 30 * 60 * 1000;
const GROUND_TRUTH_MAX_AGE_MS = 60 * 60 * 1000;

function _isFresh(e, maxAgeMs, nowMs) {
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return false;
  return (nowMs - e.ts * 1000) < maxAgeMs;
}

function recentActivity(n = 4, maxAgeMs = ACTIVITY_MAX_AGE_MS) {
  const lines = tailFileLines(ACTIVITY_LOG, 80);
  const ACTIONABLE = new Set([
    'coherence_violation', 'proxy_emergency',
    'hypothesis_registered', 'hypothesis_falsified',
  ]);
  const now = Date.now();
  const events = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (!ACTIONABLE.has(e.event)) continue;
      if (e.event === 'coherence_violation' && e.verdict === 'STALE') continue;
      if (!_isFresh(e, maxAgeMs, now)) continue;
      const parts = [e.event];
      for (const k of ['verdict', 'reason', 'tool']) {
        if (e[k] != null) parts.push(`${k}=${e[k]}`);
      }
      events.push(`  ${parts.join(' ')}`);
    } catch (_e) { /* skip malformed */ }
  }
  return events.slice(-n);
}

function recentGroundTruth(n = 1, maxAgeMs = GROUND_TRUTH_MAX_AGE_MS) {
  const lines = tailFileLines(GROUND_TRUTH_LOG, 5);
  const now = Date.now();
  const items = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (!_isFresh(e, maxAgeMs, now)) continue;
      const round = e.round_tag || e.session || '?';
      const section = String(e.section || '?').slice(0, 40);
      const sent = e.sentiment || '?';
      const comment = String(e.comment || e.content || '').replace(/\s+/g, ' ').slice(0, 80);
      items.push(`  ${round}/${section} ${sent}: ${comment}`);
    } catch (_e) { /* skip */ }
  }
  return items.slice(-n);
}

function _nexusEditCount() {
  try {
    const nexusPath = path.join(PROJECT_ROOT, 'tmp', 'hme-nexus.state');
    if (!fs.existsSync(nexusPath)) return 0;
    const lines = fs.readFileSync(nexusPath, 'utf8').split('\n');
    return lines.filter((l) => l.startsWith('EDIT:')).length;
  } catch (_e) { return 0; }
}

function _buildStatusContextRaw() {
  const coh = coherenceStatusLine();
  const errors = recentLifesaverErrors();
  const activity = recentActivity();
  const ground = recentGroundTruth();
  const editCount = _nexusEditCount();
  const dirHealth = _dirIntentHealthLine();

  const cohLine = (coh && !coh.includes('IN_BAND')) ? `coherence: ${coh}` : null;

  const hasContent = cohLine || errors.length > 0 || activity.length > 0
    || ground.length > 0 || editCount >= 5 || dirHealth;
  if (!hasContent) return null;

  const lines = ['[HME status]'];
  if (cohLine) lines.push(cohLine);
  if (editCount >= 5) lines.push(`nexus: ${editCount} unreviewed edits -- run review(mode='forget')`);
  if (dirHealth) lines.push(dirHealth);
  for (const e of errors) lines.push(`error: ${e}`);
  for (const a of activity) lines.push(a.trim());
  if (ground.length > 0) lines.push(`last verdict:${ground[0].trim()}`);
  return '\n' + lines.join('\n') + '\n';
}

function buildStatusContext() {
  const now = Date.now();
  if (_statusSnapshot !== null && now - _statusSnapshotAt < CACHE_STABLE_MS) {
    return _statusSnapshot;
  }
  _statusSnapshot = _buildStatusContextRaw();
  _statusSnapshotAt = now;
  return _statusSnapshot;
}

// Emit-once dedup. The 4-min snapshot cache prevents recomputation, not
const _lastEmittedBySession = new Map();
const _LAST_EMITTED_CAP = 64;

function consumeStatusContext(session) {
  const snapshot = buildStatusContext();
  if (snapshot === null) return null;
  const key = session || '_default';
  if (_lastEmittedBySession.get(key) === snapshot) return null;
  if (_lastEmittedBySession.size >= _LAST_EMITTED_CAP) _lastEmittedBySession.clear();
  _lastEmittedBySession.set(key, snapshot);
  return snapshot;
}

module.exports = {
  buildStatusContext,
  consumeStatusContext,
  coherenceStatusLine,
  recentLifesaverErrors,
  recentActivity,
  recentGroundTruth,
  tailFileLines,
};
