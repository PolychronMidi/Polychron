'use strict';
// Jurisdiction context -- bias bounds, KB staleness, open hypotheses,
// semantic drift. All file-backed manifest loaders live here.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const METRICS_DIR = process.env.METRICS_DIR || path.join(PROJECT_ROOT, 'output', 'metrics');
const REFRESH_INTERVAL_MS = 60_000;

const BIAS_MANIFEST = path.join(PROJECT_ROOT, 'src/scripts/pipeline/bias-bounds-manifest.json');
const STALENESS_PATH = path.join(PROJECT_ROOT, path.join(METRICS_DIR, 'kb-staleness.json'));
const HYPOTHESES_PATH = path.join(PROJECT_ROOT, path.join(METRICS_DIR, 'hme-hypotheses.json'));
const DRIFT_PATH = path.join(PROJECT_ROOT, path.join(METRICS_DIR, 'hme-semantic-drift.json'));
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
    // silent-ok: optional fallback path.
    // manifest absent or malformed -- zone-match only
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
    if (inZone) lines.push(`- Zone: hypermeta jurisdiction -- controller authority boundary`);
    if (bias.length > 0) {
      lines.push(`- Bias bounds (${bias.length}) -- locked by manifest, validated by check-hypermeta-jurisdiction:`);
      for (const b of bias.slice(0, 8)) lines.push(`    ${b.key}: [${b.lo}, ${b.hi}]`);
      if (bias.length > 8) lines.push(`    ... (+${bias.length - 8} more)`);
    }
    if (stale) {
      const ds = typeof stale.staleness_days === 'number' ? `${stale.staleness_days.toFixed(1)}d` : '?';
      lines.push(`- KB status: ${stale.status}  (${stale.kb_entries_matched} entry matches, delta ${ds})`);
    }
    if (hypotheses.length > 0) {
      lines.push(`- Open hypotheses (${hypotheses.length}) -- this edit may confirm or refute:`);
      for (const h of hypotheses.slice(0, 4)) {
        lines.push(`    \`${h.id}\`: ${String(h.claim || '').slice(0, 140)}`);
        lines.push(`      falsifier: ${String(h.falsification || '').slice(0, 120)}`);
      }
      if (hypotheses.length > 4) lines.push(`    ... (+${hypotheses.length - 4} more)`);
    }
    if (drifted) {
      const fieldsChanged = (drifted.diffs || [])
        .filter((d) => d.field !== 'content_hash_prefix')
        .map((d) => d.field);
      lines.push(
        `- [!] KB semantic drift: the baseline signature for this module has diverged ` +
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
    'Write-bearing tool calls in this turn target files tracked by the hypermeta layer. Before editing, confirm the changes respect the constraints below -- check-hypermeta-jurisdiction.js will fail the pipeline otherwise.',
    '',
    ...lines,
  ].join('\n');
}

function openHypothesesFor(stem) { return loadOpenHypothesesMap().get(stem) || []; }
function biasBoundsFor(relPath) { return loadBiasManifest().get(relPath) || []; }
function driftFor(stem) { return loadDriftMap().get(stem) || null; }

module.exports = {
  loadBiasManifest,
  loadStalenessMap,
  loadOpenHypothesesMap,
  loadDriftMap,
  isJurisdictionFile,
  buildJurisdictionContext,
  openHypothesesFor,
  biasBoundsFor,
  driftFor,
};
