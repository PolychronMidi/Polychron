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
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');
const TRACE = path.join(METRICS_DIR, 'trace-summary.json');
const OUT = path.join(METRICS_DIR, 'legacy-override-history.jsonl');

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

  // #7: axis_rebalance_cost -- total adjustments per 100 beats across all axes.
  // Trend signal: rising cost = system working harder to stay balanced.
  const totalAdj = Object.values(aee.perAxisAdj || {})
    .reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  const cost = aee.beatCount > 0 ? (totalAdj / aee.beatCount) * 100 : 0;
  try {
    const { spawn } = require('child_process');
    spawn('python3', [
      path.join(ROOT, 'tools', 'HME', 'activity', 'emit.py'),
      '--event=axis_rebalance_cost',
      `--total_adjustments=${totalAdj}`,
      `--beats=${aee.beatCount}`,
      `--cost_per_100_beats=${cost.toFixed(2)}`,
      '--session=pipeline',
    ], { stdio: 'ignore', detached: true, cwd: ROOT,
         env: Object.assign({}, process.env, { PROJECT_ROOT: ROOT }) }).unref();
  } catch (_e) { /* best-effort */ }

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
    // R15: Flatten deviation details into per-axis CLI args so emit.py produces
    // a queryable activity event with discrete fields (not a JSON string blob).
    const args = [
      path.join(ROOT, 'tools', 'HME', 'activity', 'emit.py'),
      '--event=axis_share_deviation',
      `--count=${deviations.length}`,
      `--max_abs_delta_pct=${Math.max(...deviations.map((d) => Math.abs(d.delta_pct))).toFixed(3)}`,
      '--session=pipeline',
    ];
    deviations.slice(0, 6).forEach((d, i) => {
      args.push(`--axis${i}=${d.axis}`);
      args.push(`--share${i}=${d.share}`);
      args.push(`--delta_pct${i}=${d.delta_pct}`);
    });
    try {
      spawn('python3', args, { stdio: 'ignore', detached: true, cwd: ROOT,
           env: Object.assign({}, process.env, { PROJECT_ROOT: ROOT }) }).unref();
    } catch (_e) { /* best-effort */ }

    // R15 #10: Wire sustained deviations (3+ consecutive rounds) to the
    // hci-regression-alert so i/status surfaces composition-health drift
    // even when HCI itself is stable.
    try {
      const histPath = path.join(METRICS_DIR, 'legacy-override-history.jsonl');
      const lines = fs.readFileSync(histPath, 'utf8').split('\n').filter(Boolean);
      const recent = lines.slice(-3).map((l) => {
        try { return JSON.parse(l); } catch (_e) { return null; }
      }).filter(Boolean);
      if (recent.length >= 3) {
        const stuck = new Set();
        const FS = 1 / 6;
        for (const r of recent) {
          for (const [ax, sh] of Object.entries(r.smoothed_shares || {})) {
            if (typeof sh === 'number' && Math.abs(sh - FS) / FS > DEVIATION_FRAC) stuck.add(ax);
          }
        }
        // Keep only axes that deviate in ALL 3 recent rounds
        const persistent = [...stuck].filter((ax) =>
          recent.every((r) => {
            const sh = (r.smoothed_shares || {})[ax];
            return typeof sh === 'number' && Math.abs(sh - FS) / FS > DEVIATION_FRAC;
          })
        );
        if (persistent.length > 0) {
          const alertPath = path.join(METRICS_DIR, 'hci-regression-alert.json');
          fs.writeFileSync(alertPath, JSON.stringify({
            ts: new Date().toISOString(),
            kind: 'axis_share_persistent_deviation',
            axes: persistent,
            rounds: recent.length,
            action: `Axes ${persistent.join(', ')} have been >20% off FAIR_SHARE for ${recent.length} consecutive rounds. Investigate controller tuning.`,
          }, null, 2) + '\n');
        }
      }
    } catch (_deve) { /* best-effort */ }
  }
}

main();
