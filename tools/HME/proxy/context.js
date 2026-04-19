'use strict';
// Jurisdiction context + session-status injection. All file-backed cache loaders live here.

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');

const INJECT = (process.env.HME_PROXY_INJECT ?? '1') !== '0';
const REFRESH_INTERVAL_MS = 60_000;

//  Coherence budget
const COHERENCE_BUDGET_PATH = path.join(PROJECT_ROOT, 'metrics', 'hme-coherence-budget.json');
let _budgetState = null;
let _budgetLoadedAt = 0;

function loadCoherenceBudget() {
  const now = Date.now();
  if (_budgetState !== null && now - _budgetLoadedAt < REFRESH_INTERVAL_MS) return _budgetState;
  try {
    const raw = fs.readFileSync(COHERENCE_BUDGET_PATH, 'utf8');
    const data = JSON.parse(raw);
    const score = data.current_coherence;
    const band = data.band;
    if (typeof score === 'number' && Array.isArray(band) && band.length === 2) {
      if (score < band[0]) _budgetState = 'below';
      else if (score > band[1]) _budgetState = 'above';
      else _budgetState = 'in_band';
    }
  } catch (_err) {
    _budgetState = 'in_band';
  }
  _budgetLoadedAt = now;
  return _budgetState;
}

function shouldInject() {
  if (!INJECT) return false;
  return loadCoherenceBudget() !== 'above';
}

//  File-backed manifest loaders
const BIAS_MANIFEST = path.join(PROJECT_ROOT, 'scripts/pipeline/bias-bounds-manifest.json');
const STALENESS_PATH = path.join(PROJECT_ROOT, 'metrics/kb-staleness.json');
const HYPOTHESES_PATH = path.join(PROJECT_ROOT, 'metrics/hme-hypotheses.json');
const DRIFT_PATH = path.join(PROJECT_ROOT, 'metrics/hme-semantic-drift.json');
const JURISDICTION_ZONES = [
  'src/conductor/signal/meta/',
  'src/conductor/signal/profiling/',
];
let _biasByFile = null;
let _biasLoadedAt = 0;
let _stalenessByModule = null;
let _stalenessLoadedAt = 0;
let _openHypothesesByModule = null;
let _hypothesesLoadedAt = 0;
let _driftByModule = null;
let _driftLoadedAt = 0;

function loadBiasManifest() {
  const now = Date.now();
  if (_biasByFile && now - _biasLoadedAt < REFRESH_INTERVAL_MS) return _biasByFile;
  _biasByFile = new Map();
  try {
    const raw = fs.readFileSync(BIAS_MANIFEST, 'utf8');
    const data = JSON.parse(raw);
    const regs = data && data.registrations;
    if (regs && typeof regs === 'object') {
      for (const [key, info] of Object.entries(regs)) {
        if (!info || typeof info !== 'object' || !info.file) continue;
        const arr = _biasByFile.get(info.file) || [];
        arr.push({ key, lo: info.lo, hi: info.hi });
        _biasByFile.set(info.file, arr);
      }
    }
  } catch (_err) {
    // manifest absent or malformed — zone-match only
  }
  _biasLoadedAt = now;
  return _biasByFile;
}

function loadStalenessMap() {
  const now = Date.now();
  if (_stalenessByModule && now - _stalenessLoadedAt < REFRESH_INTERVAL_MS) return _stalenessByModule;
  _stalenessByModule = new Map();
  try {
    const raw = fs.readFileSync(STALENESS_PATH, 'utf8');
    const data = JSON.parse(raw);
    for (const m of data.modules || []) {
      if (m.module) _stalenessByModule.set(m.module, m);
    }
  } catch (_err) { /* staleness index absent */ }
  _stalenessLoadedAt = now;
  return _stalenessByModule;
}

function loadOpenHypothesesMap() {
  const now = Date.now();
  if (_openHypothesesByModule && now - _hypothesesLoadedAt < REFRESH_INTERVAL_MS) return _openHypothesesByModule;
  _openHypothesesByModule = new Map();
  try {
    const raw = fs.readFileSync(HYPOTHESES_PATH, 'utf8');
    const data = JSON.parse(raw);
    for (const h of data.hypotheses || []) {
      if (h.status !== 'OPEN') continue;
      for (const mod of h.modules || []) {
        const arr = _openHypothesesByModule.get(mod) || [];
        arr.push(h);
        _openHypothesesByModule.set(mod, arr);
      }
    }
  } catch (_err) { /* no registry yet */ }
  _hypothesesLoadedAt = now;
  return _openHypothesesByModule;
}

function loadDriftMap() {
  const now = Date.now();
  if (_driftByModule && now - _driftLoadedAt < REFRESH_INTERVAL_MS) return _driftByModule;
  _driftByModule = new Map();
  try {
    const raw = fs.readFileSync(DRIFT_PATH, 'utf8');
    const data = JSON.parse(raw);
    for (const d of data.drifted_entries || []) {
      if (d.module) _driftByModule.set(d.module, d);
    }
  } catch (_err) { /* no drift report yet */ }
  _driftLoadedAt = now;
  return _driftByModule;
}

function isJurisdictionFile(filePath) {
  if (!filePath) return false;
  if (JURISDICTION_ZONES.some((z) => filePath.includes(z))) return true;
  const biasMap = loadBiasManifest();
  for (const manifestPath of biasMap.keys()) {
    if (filePath.endsWith(manifestPath)) return true;
  }
  const stem = path.basename(filePath, path.extname(filePath));
  if (loadOpenHypothesesMap().has(stem)) return true;
  if (loadDriftMap().has(stem)) return true;
  return false;
}

function buildJurisdictionContext(filePaths) {
  if (!filePaths || filePaths.length === 0) return null;
  const biasMap = loadBiasManifest();
  const staleMap = loadStalenessMap();
  const hypMap = loadOpenHypothesesMap();
  const driftMap = loadDriftMap();
  const lines = [];
  let anyMatched = false;
  for (const fp of filePaths) {
    const idx = fp.indexOf('src/');
    const rel = idx >= 0 ? fp.slice(idx) : fp;
    const stem = path.basename(rel, path.extname(rel));
    const bias = biasMap.get(rel) || [];
    const stale = staleMap.get(stem);
    const hypotheses = hypMap.get(stem) || [];
    const drifted = driftMap.get(stem);
    const inZone = JURISDICTION_ZONES.some((z) => rel.includes(z));
    if (!inZone && bias.length === 0 && !stale && hypotheses.length === 0 && !drifted) continue;
    anyMatched = true;
    lines.push(`### ${rel}`);
    if (inZone) lines.push(`- Zone: hypermeta jurisdiction — controller authority boundary`);
    if (bias.length > 0) {
      lines.push(`- Bias bounds (${bias.length}) — locked by manifest, validated by check-hypermeta-jurisdiction:`);
      for (const b of bias.slice(0, 8)) lines.push(`    ${b.key}: [${b.lo}, ${b.hi}]`);
      if (bias.length > 8) lines.push(`    … (+${bias.length - 8} more)`);
    }
    if (stale) {
      const ds = typeof stale.staleness_days === 'number' ? `${stale.staleness_days.toFixed(1)}d` : '?';
      lines.push(`- KB status: ${stale.status}  (${stale.kb_entries_matched} entry matches, delta ${ds})`);
    }
    if (hypotheses.length > 0) {
      lines.push(`- Open hypotheses (${hypotheses.length}) — this edit may confirm or refute:`);
      for (const h of hypotheses.slice(0, 4)) {
        lines.push(`    \`${h.id}\`: ${String(h.claim || '').slice(0, 140)}`);
        lines.push(`      falsifier: ${String(h.falsification || '').slice(0, 120)}`);
      }
      if (hypotheses.length > 4) lines.push(`    … (+${hypotheses.length - 4} more)`);
    }
    if (drifted) {
      const fieldsChanged = (drifted.diffs || [])
        .filter((d) => d.field !== 'content_hash_prefix')
        .map((d) => d.field);
      lines.push(
        `- ⚠ KB semantic drift: the baseline signature for this module has diverged ` +
          `(${fieldsChanged.length} structural field(s): ${fieldsChanged.slice(0, 4).join(', ')}). ` +
          `KB description may be wrong.`,
      );
    }
    lines.push('');
  }
  if (!anyMatched) return null;
  return [
    '',
    '## HME Jurisdiction Context (proxy-injected)',
    '',
    'Write-bearing tool calls in this turn target files tracked by the hypermeta layer. Before editing, confirm the changes respect the constraints below — check-hypermeta-jurisdiction.js will fail the pipeline otherwise.',
    '',
    ...lines,
  ].join('\n');
}

//  Session status context (S1+S2+S3+S4)
// Status is injected once per turn as the last system block with cache_control.
// To maximise Anthropic cache hits, the text must be byte-identical within each
// 5-minute cache window. We achieve this by:
//   1. Snapshotting the status block at most once per CACHE_STABLE_MS interval.
//   2. Stripping wall-clock timestamps from activity lines (date is enough).
//   3. Capping volatile log tails so minor log growth doesn't bust the cache.
const CACHE_STABLE_MS = 4 * 60 * 1000; // 4 min < 5-min Anthropic TTL
let _statusSnapshot = null;
let _statusSnapshotAt = 0;

const ERRORS_LOG = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
const ACTIVITY_LOG = path.join(PROJECT_ROOT, 'metrics', 'hme-activity.jsonl');
const GROUND_TRUTH_LOG = path.join(PROJECT_ROOT, 'metrics', 'hme-ground-truth.jsonl');
const DIR_INTENT_PATH = path.join(PROJECT_ROOT, 'metrics', 'hme-dir-intent.json');

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
    return null; // no index yet or parse error — silent
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
  // Turn-aware: show only errors added since userpromptsubmit.sh recorded the
  // turn-start line count in tmp/hme-errors.turnstart. This is the same anchor
  // LIFESAVER uses, so the proxy's in-context reminders stay synchronized with
  // the turn-boundary banner — no stale errors from prior turns and no fall-off
  // after a fixed clock window.
  //
  // Fallback: if the turnstart file is missing (first turn, fresh clone), keep
  // a 30-min clock cutoff so the injection is still bounded.
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
    // Read the full file line-count so we can slice by absolute position.
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

  // Strip sub-second and time-of-day from timestamps so the injected block
  // stays byte-identical within the 4-min cache window.
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
  // Only events the agent must act on — passive telemetry excluded.
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
  // Only the most recent verdict — the agent has session memory; older ones
  // are already in context. Injecting 3 per turn is chronic token waste.
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

  // Suppress coherence when nominal — only signal deviations worth acting on.
  const cohLine = (coh && !coh.includes('IN_BAND')) ? `coherence: ${coh}` : null;

  const hasContent = cohLine || errors.length > 0 || activity.length > 0
    || ground.length > 0 || editCount >= 5 || dirHealth;
  if (!hasContent) return null;

  // Compact key=value format — no markdown headers, no blank lines between items.
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

function stripSystemCacheControl(payload) {
  // Strip ALL cache_control from system blocks. Old proxy versions added them;
  // stale markers in conversation history cause Anthropic 400 TTL ordering
  // errors. Claude Code re-establishes its own markers on every request.
  if (!Array.isArray(payload.system)) return false;
  let stripped = false;
  for (const b of payload.system) {
    if (b && b.cache_control) { delete b.cache_control; stripped = true; }
  }
  return stripped;
}

function injectIntoSystem(payload, block, marker = 'HME Jurisdiction Context (proxy-injected)') {
  if (!block) return false;
  if (typeof payload.system === 'string') {
    if (payload.system.includes(marker)) return false;
    payload.system = payload.system + block;
    return true;
  }
  if (Array.isArray(payload.system)) {
    const already = payload.system.some((b) => {
      const t = typeof b === 'string' ? b : b && b.text;
      return typeof t === 'string' && t.includes(marker);
    });
    if (already) return false;
    payload.system.push({ type: 'text', text: block });
    return true;
  }
  if (payload.system == null) {
    payload.system = block;
    return true;
  }
  return false;
}

// Targeted lookups exposed for enrichment middleware that needs data but not
// prose — each returns raw data so the caller chooses how to surface it.
function openHypothesesFor(stem) { return loadOpenHypothesesMap().get(stem) || []; }
function biasBoundsFor(relPath) { return loadBiasManifest().get(relPath) || []; }
function driftFor(stem) { return loadDriftMap().get(stem) || null; }

module.exports = {
  shouldInject,
  buildStatusContext,
  buildJurisdictionContext,
  injectIntoSystem,
  stripSystemCacheControl,
  isJurisdictionFile,
  openHypothesesFor,
  biasBoundsFor,
  driftFor,
  // exported for test-proxy compatibility
  coherenceStatusLine,
  recentLifesaverErrors,
  recentActivity,
  recentGroundTruth,
  tailFileLines,
};
