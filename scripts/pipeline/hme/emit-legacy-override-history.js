// scripts/pipeline/hme/emit-legacy-override-history.js
//
// Read axisEnergyEquilibrator.perLegacyOverride + perLegacyOverrideEntries
// from metrics/trace-summary.json and append one row per pipeline run to
// metrics/legacy-override-history.jsonl. Enables trend analysis: "has
// entropy-cap-0.19 ever fired?" is a simple grep over history.
//
// Writes a one-line console summary for pipeline output consumption.
// Non-fatal -- missing trace-summary is a skip, not an error.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TRACE = path.join(ROOT, 'metrics', 'trace-summary.json');
const OUT = path.join(ROOT, 'metrics', 'legacy-override-history.jsonl');

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_e) { return null; }
}

function main() {
  const trace = loadJson(TRACE);
  if (!trace) {
    console.log('emit-legacy-override-history: trace-summary missing -- skip');
    return;
  }
  const aee = trace.axisEnergyEquilibrator || {};
  const fires = aee.perLegacyOverride || {};
  const entries = aee.perLegacyOverrideEntries || {};
  if (!Object.keys(fires).length) {
    console.log('emit-legacy-override-history: no perLegacyOverride data -- skip');
    return;
  }
  const { execSync } = require('child_process');
  let sha = null;
  try {
    sha = execSync('git rev-parse --short HEAD', {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (_e) { /* optional */ }
  // Include perAxisAdj (per-axis adjustment counts) so round-over-round
  // variance is visible. Trust axis has shown high variance (13 -> 25 -> 59)
  // across recent rounds; tracking exposes whether that's healthy cadence
  // vs controller instability.
  const record = {
    ts: new Date().toISOString(),
    sha: sha,
    beat_count: aee.beatCount,
    fires: fires,
    entries: entries,
    per_axis_adj: aee.perAxisAdj || {},
    smoothed_shares: aee.smoothedShares || {},
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.appendFileSync(OUT, JSON.stringify(record) + '\n');
  const summary = Object.entries(fires)
    .map(([id, n]) => `${id.split('-')[0]}=${n}`)
    .join(' ');
  console.log(`emit-legacy-override-history: ${summary}`);

  // axis-share-deviation: emit activity event when any axis share stays more
  // than 20% from FAIR_SHARE (1/6 = 0.1667). Silent when balanced.
  const FAIR_SHARE = 1 / 6;
  const DEVIATION_FRAC = 0.20;
  const shares = aee.smoothedShares || {};
  const deviations = [];
  for (const [axis, share] of Object.entries(shares)) {
    if (typeof share !== 'number') continue;
    const delta = share - FAIR_SHARE;
    const pct = Math.abs(delta) / FAIR_SHARE;
    if (pct > DEVIATION_FRAC) {
      deviations.push({ axis, share: Number(share.toFixed(4)), delta_pct: Number((delta / FAIR_SHARE).toFixed(3)) });
    }
  }
  if (deviations.length > 0) {
    const { spawn } = require('child_process');
    try {
      spawn('python3', [
        path.join(ROOT, 'tools', 'HME', 'activity', 'emit.py'),
        '--event=axis_share_deviation',
        `--count=${deviations.length}`,
        `--summary=${JSON.stringify(deviations).slice(0, 200)}`,
        '--session=pipeline',
      ], { stdio: 'ignore', detached: true, cwd: ROOT,
           env: Object.assign({}, process.env, { PROJECT_ROOT: ROOT }) }).unref();
    } catch (_e) { /* best-effort */ }
  }
}

main();
