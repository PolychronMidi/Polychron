'use strict';
// Jurisdiction context + session-status injection. All file-backed cache loaders live here.

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');

const INJECT = (process.env.HME_PROXY_INJECT ?? '1') !== '0';
const REFRESH_INTERVAL_MS = 60_000;

// ── Coherence budget ─────────────────────────────────────────────────────────
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

// ── File-backed manifest loaders ─────────────────────────────────────────────
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
    'If any bias bound is stale, re-snapshot with:',
    '  node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds',
    '',
    'If a drifted KB entry is shown, re-capture its signature after updating the description:',
    '  python3 scripts/pipeline/hme/capture-kb-signatures.py',
    '',
  ].join('\n');
}

// ── Session status context (S1+S2+S3+S4) ────────────────────────────────────
const ERRORS_LOG = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
const ACTIVITY_LOG = path.join(PROJECT_ROOT, 'metrics', 'hme-activity.jsonl');
const GROUND_TRUTH_LOG = path.join(PROJECT_ROOT, 'metrics', 'hme-ground-truth.jsonl');

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
  const lines = tailFileLines(ERRORS_LOG, 20);
  const now = Date.now();
  const CUTOFF_MS = 30 * 60 * 1000;
  const fresh = [];
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]/);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (Number.isNaN(t)) continue;
    if (now - t < CUTOFF_MS) fresh.push(line);
  }
  return fresh.slice(-5);
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

function recentActivity(n = 8) {
  const lines = tailFileLines(ACTIVITY_LOG, 80);
  const HIGH_SIGNAL = new Set([
    'round_complete', 'coherence_violation', 'pipeline_complete',
    'jurisdiction_inject', 'ground_truth_recorded', 'proxy_emergency',
    'hypothesis_registered', 'hypothesis_falsified', 'injection_influence',
  ]);
  const events = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (!HIGH_SIGNAL.has(e.event)) continue;
      const ts = (e.timestamp || e.ts || '?').slice(0, 19);
      const parts = [e.event];
      for (const k of ['session', 'verdict', 'reason', 'targets', 'tool']) {
        if (e[k] != null) parts.push(`${k}=${e[k]}`);
      }
      events.push(`  ${ts}  ${parts.join(' ')}`);
    } catch (_e) { /* skip malformed */ }
  }
  return events.slice(-n);
}

function recentGroundTruth(n = 3) {
  const lines = tailFileLines(GROUND_TRUTH_LOG, 10);
  const items = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      const round = e.round_tag || e.session || '?';
      const section = String(e.section || '?').slice(0, 60);
      const mt = e.moment_type || '?';
      const sent = e.sentiment || '?';
      const comment = String(e.comment || e.content || '').replace(/\s+/g, ' ').slice(0, 160);
      items.push(`  ${round} / ${section} — ${sent} ${mt}: ${comment}`);
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

function buildStatusContext() {
  const coh = coherenceStatusLine();
  const errors = recentLifesaverErrors();
  const activity = recentActivity();
  const ground = recentGroundTruth();
  const editCount = _nexusEditCount();
  if (!coh && errors.length === 0 && activity.length === 0 && ground.length === 0 && editCount === 0) return null;
  const lines = ['', '## HME Session Status (proxy-injected)', ''];
  if (coh) lines.push(`**Coherence:** ${coh}`, '');
  if (editCount >= 3) {
    const severity = editCount >= 5 ? 'run' : 'consider';
    lines.push(`**NEXUS:** ${editCount} file(s) edited since last review — ${severity} \`mcp__HME__review(mode='forget')\` to clear the backlog.`, '');
  }
  if (errors.length > 0) {
    lines.push('**⚠ Recent LIFESAVER errors (last 30min):**');
    for (const e of errors) lines.push(`  ${e}`);
    lines.push('');
  }
  if (activity.length > 0) {
    lines.push('**Recent high-signal activity:**');
    lines.push(...activity);
    lines.push('');
  }
  if (ground.length > 0) {
    lines.push('**Recent listening verdicts (ground truth):**');
    lines.push(...ground);
    lines.push('');
  }
  return lines.join('\n');
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

// ── File enrichment (for Read-augmentation middleware) ──────────────────────
// Given an absolute or project-relative file path, return a compact footer
// summarizing everything HME knows about the file from its loaded maps:
// staleness, bias bounds, open hypotheses, drift warnings, jurisdiction zone.
// Returns null when the file has no HME coverage — caller should skip the
// enrichment.
function buildFileEnrichment(filePath) {
  if (!filePath) return null;
  const idx = filePath.indexOf('src/');
  const rel = idx >= 0 ? filePath.slice(idx) : filePath;
  const stem = path.basename(rel, path.extname(rel));

  const bias = (loadBiasManifest().get(rel) || []);
  const stale = loadStalenessMap().get(stem);
  const hypotheses = loadOpenHypothesesMap().get(stem) || [];
  const drifted = loadDriftMap().get(stem);
  const inZone = JURISDICTION_ZONES.some((z) => rel.includes(z));

  if (!inZone && bias.length === 0 && !stale && hypotheses.length === 0 && !drifted) {
    return null;
  }

  const lines = [];
  if (stale) {
    const ds = typeof stale.staleness_days === 'number' ? `${stale.staleness_days.toFixed(1)}d` : '?';
    lines.push(`KB: ${stale.status} (${stale.kb_entries_matched} entries, ${ds} old)`);
  }
  if (inZone) {
    lines.push(`Zone: hypermeta jurisdiction — edits constrained by controller authority`);
  }
  if (bias.length > 0) {
    const keys = bias.slice(0, 3).map((b) => b.key).join(', ');
    const tail = bias.length > 3 ? `, +${bias.length - 3}` : '';
    lines.push(`Bias bounds (${bias.length}): ${keys}${tail}`);
  }
  if (hypotheses.length > 0) {
    const first = hypotheses[0];
    const claim = String(first.claim || '').slice(0, 100);
    lines.push(`Open hypotheses (${hypotheses.length}): \`${first.id}\` ${claim}`);
  }
  if (drifted) {
    const fields = (drifted.diffs || [])
      .filter((d) => d.field !== 'content_hash_prefix')
      .map((d) => d.field)
      .slice(0, 3);
    lines.push(`⚠ KB drift: signature diverged (${fields.join(', ')}) — description may be wrong`);
  }

  if (lines.length === 0) return null;
  return ['', '── HME enrichment ──', ...lines, '────────────────────'].join('\n');
}

// Checks whether a file falls within the RAG-indexed directories declared in
// .mcp.json's ragIndexDirs. Used by the read-augmentation middleware to
// decide whether to attempt enrichment. Cached at module scope, refreshed
// on the same interval as other loaders.
const MCP_JSON_PATH = path.join(PROJECT_ROOT, '.mcp.json');
let _indexedDirs = null;
let _indexedDirsLoadedAt = 0;

function loadIndexedDirs() {
  const now = Date.now();
  if (_indexedDirs && now - _indexedDirsLoadedAt < REFRESH_INTERVAL_MS) return _indexedDirs;
  _indexedDirs = [];
  try {
    const raw = fs.readFileSync(MCP_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    const hme = data && data.mcpServers && data.mcpServers.HME;
    if (hme && Array.isArray(hme.ragIndexDirs)) {
      _indexedDirs = hme.ragIndexDirs.map((d) => d.replace(/\/+$/, ''));
    }
  } catch (_err) { /* no config — empty list means no enrichment */ }
  _indexedDirsLoadedAt = now;
  return _indexedDirs;
}

function isFileIndexed(filePath) {
  if (!filePath) return false;
  // Normalize to project-relative.
  const abs = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
  const rel = abs.startsWith(PROJECT_ROOT + '/') ? abs.slice(PROJECT_ROOT.length + 1) : abs;
  for (const dir of loadIndexedDirs()) {
    if (!dir) continue;
    if (rel === dir || rel.startsWith(dir + '/')) return true;
  }
  return false;
}

module.exports = {
  shouldInject,
  buildStatusContext,
  buildJurisdictionContext,
  injectIntoSystem,
  isJurisdictionFile,
  buildFileEnrichment,
  isFileIndexed,
  // exported for test-proxy compatibility
  coherenceStatusLine,
  recentLifesaverErrors,
  recentActivity,
  recentGroundTruth,
  tailFileLines,
};
