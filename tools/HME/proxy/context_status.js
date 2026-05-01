'use strict';
// Session status context (S1+S2+S3+S4). Snapshotted at most once per
// CACHE_STABLE_MS so injected text stays byte-identical inside the
// 5-min Anthropic prompt-cache window.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const METRICS_DIR = process.env.METRICS_DIR || path.join(PROJECT_ROOT, 'output', 'metrics');

const CACHE_STABLE_MS = 4 * 60 * 1000;
let _statusSnapshot = null;
let _statusSnapshotAt = 0;

const COHERENCE_BUDGET_PATH = path.join(METRICS_DIR, 'hme-coherence-budget.json');
const ERRORS_LOG = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
const ACTIVITY_LOG = path.join(METRICS_DIR, 'hme-activity.jsonl');
const GROUND_TRUTH_LOG = path.join(METRICS_DIR, 'hme-ground-truth.jsonl');
const DIR_INTENT_PATH = path.join(METRICS_DIR, 'hme-dir-intent.json');

function _dirIntentHealthLine() {
  try {
    const raw = fs.readFileSync(DIR_INTENT_PATH, 'utf8');
    const d = JSON.parse(raw);
    const c = (d && d.counts) || {};
    const parts = [];
    if (c.drifted) parts.push(`${c.drifted} drifted`);
    if (c.invalid) parts.push(`${c.invalid} invalid`);
    if (parts.length === 0) return null;
    return `dir-intent: ${parts.join(', ')} — run build-dir-intent-index.py to investigate`;
  } catch (_err) {
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
    return [];
  }
}

function recentLifesaverErrors() {
  // Turn-aware: show only errors added since userpromptsubmit.sh recorded
  // the turn-start line count in tmp/hme-errors.turnstart.
  const TURNSTART_PATH = path.join(PROJECT_ROOT, 'tmp', 'hme-errors.turnstart');
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

  return fresh.slice(-5).map((line) => {
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
    return null;
  }
}

function recentActivity(n = 4) {
  const lines = tailFileLines(ACTIVITY_LOG, 80);
  const ACTIONABLE = new Set([
    'coherence_violation', 'proxy_emergency',
    'hypothesis_registered', 'hypothesis_falsified',
  ]);
  const events = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (!ACTIONABLE.has(e.event)) continue;
      const parts = [e.event];
      for (const k of ['verdict', 'reason', 'tool']) {
        if (e[k] != null) parts.push(`${k}=${e[k]}`);
      }
      events.push(`  ${parts.join(' ')}`);
    } catch (_e) { /* skip malformed */ }
  }
  return events.slice(-n);
}

function recentGroundTruth(n = 1) {
  const lines = tailFileLines(GROUND_TRUTH_LOG, 5);
  const items = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
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
  if (editCount >= 5) lines.push(`nexus: ${editCount} unreviewed edits — run review(mode='forget')`);
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

module.exports = {
  buildStatusContext,
  coherenceStatusLine,
  recentLifesaverErrors,
  recentActivity,
  recentGroundTruth,
  tailFileLines,
};
