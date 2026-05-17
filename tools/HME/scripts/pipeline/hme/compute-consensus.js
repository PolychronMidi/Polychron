// Cross-substrate consensus: 7 substrates (HCI, invariants, predictions,
// fingerprint, axis rebalance, CLAP, listening verdict) each map to [-1,+1].
// Mean = consensus, stdev = divergence (often more actionable than any single
// verdict). Output: metrics/hme-consensus.json; emits consensus_divergence
// activity event when stdev exceeds threshold. Non-fatal.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = (process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..', '..'));
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'src', 'output', 'metrics');
const OUT = path.join(METRICS_DIR, 'hme-consensus.json');
const DIVERGENCE_THRESHOLD = 0.4;  // stdev above this triggers divergence alert

// R32: voters extracted to consensus_voters.js. Adding a new voter = define
// it in that module + import below. Orchestration stays here.
const { makeVoters } = require('./consensus_voters');
const _v = makeVoters(ROOT);
const loadJson = _v.loadJson;
const voteHci = _v.voteHci;
const voteInvariants = _v.voteInvariants;
const votePredictionRecall = _v.votePredictionRecall;
const voteVerdict = _v.voteVerdict;
const voteAxisCostTrend = _v.voteAxisCostTrend;
const voteClapStability = _v.voteClapStability;
const voteListeningVerdict = _v.voteListeningVerdict;

// main

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

function main() {
  const voters = {
    hci:                 voteHci(),
    invariants:          voteInvariants(),
    prediction_recall:   votePredictionRecall(),
    verdict_numeric:     voteVerdict(),
    axis_cost_trend:     voteAxisCostTrend(),
    clap_stability:      voteClapStability(),
    listening_verdict:   voteListeningVerdict(),
  };

  const activeVoters = Object.entries(voters).filter(([, v]) => v !== null);
  const activeValues = activeVoters.map(([, v]) => v);

  if (activeValues.length < 2) {
    console.log('compute-consensus: insufficient voters (<2) -- skip');
    return;
  }

  const m = mean(activeValues);
  const sd = stdev(activeValues);

  // R25 #10: time-averaged per-voter metrics. Compute rolling mean + slope
  const voterTrajectories = {};
  try {
    const tsPath = path.join(METRICS_DIR, 'hme-arc-timeseries.jsonl');
    if (fs.existsSync(tsPath)) {
      // Timeseries doesn't carry per-voter scalars (just outlier_voters array).
      const histPath = path.join(METRICS_DIR, 'hme-consensus-history.jsonl');
      const prevLines = fs.existsSync(histPath)
        ? fs.readFileSync(histPath, 'utf8').split('\n').filter(Boolean)
        : [];
      const prevRows = prevLines.slice(-4).map((l) => {
        try { return JSON.parse(l); } catch (_e) { return null; }
      }).filter(Boolean);
      // Compute trajectory per voter from prev + current.
      for (const [name, score] of activeVoters) {
        const series = prevRows.map((r) => r.voters ? r.voters[name] : null)
          .filter((x) => typeof x === 'number');
        series.push(score);
        if (series.length >= 2) {
          const trajMean = series.reduce((a, b) => a + b, 0) / series.length;
          const slope = (series[series.length - 1] - series[0]) / (series.length - 1);
          voterTrajectories[name] = {
            mean: Number(trajMean.toFixed(3)),
            slope: Number(slope.toFixed(3)),
            n: series.length,
          };
        }
      }
      // Append current round to history (even if computed series was short)
      const curVoters = Object.fromEntries(Object.entries(voters)
        .map(([k, v]) => [k, v === null ? null : Number(v.toFixed(3))]));
      fs.appendFileSync(histPath, JSON.stringify({
        ts: new Date().toISOString(),
        voters: curVoters,
        mean: Number(m.toFixed(3)),
        stdev: Number(sd.toFixed(3)),
      }) + '\n');
    }
  } catch (_tre) { /* best-effort */ }

  // Identify outliers: voters >1.5 stdev from mean.
  const outliers = activeVoters
    .filter(([, v]) => Math.abs(v - m) > 1.5 * sd)
    .map(([name, v]) => ({ voter: name, score: Number(v.toFixed(3)), delta_from_mean: Number((v - m).toFixed(3)) }));

  let divergenceLevel = 'low';
  if (sd > DIVERGENCE_THRESHOLD) divergenceLevel = 'high';
  else if (sd > DIVERGENCE_THRESHOLD / 2) divergenceLevel = 'moderate';

  // R29 #4: composition_reality_overrides_substrate_divergence.
  let overrideApplied = false;
  try {
    const gtPath = path.join(METRICS_DIR, 'hme-ground-truth.jsonl');
    const sumPath = path.join(METRICS_DIR, 'pipeline-summary.json');
    if (fs.existsSync(gtPath) && fs.existsSync(sumPath)) {
      const gtLines = fs.readFileSync(gtPath, 'utf8').split('\n').filter(Boolean);
      const recentGt = gtLines.slice(-3).map((l) => {
        try { return JSON.parse(l); } catch (_e) { return null; }
      }).filter(Boolean);
      const allLegendary = recentGt.length >= 3 && recentGt.every((g) =>
        (g.tags || []).map((t) => String(t).toLowerCase()).includes('legendary'));
      const summary = JSON.parse(fs.readFileSync(sumPath, 'utf8'));
      const hciOk = typeof summary.hci === 'number' && summary.hci >= 95;
      if (allLegendary && hciOk && divergenceLevel !== 'low') {
        overrideApplied = true;
        divergenceLevel = 'low_override_by_reality';
      }
    }
  } catch (_ore) { /* best-effort */ }

  let sha = null;
  try {
    sha = execSync('git rev-parse --short HEAD', {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (_e) { /* optional */ }

  const record = {
    ts: new Date().toISOString(),
    sha: sha,
    voters: Object.fromEntries(Object.entries(voters)
      .map(([k, v]) => [k, v === null ? null : Number(v.toFixed(3))])),
    active_count: activeValues.length,
    mean: Number(m.toFixed(3)),
    stdev: Number(sd.toFixed(3)),
    divergence: divergenceLevel,
    divergence_override_applied: overrideApplied,
    outliers: outliers,
    voter_trajectories: voterTrajectories,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');

  const summary = activeVoters
    .map(([n, v]) => `${n.split('_')[0]}=${v.toFixed(2)}`)
    .join(' ');
  console.log(`compute-consensus: mean=${m.toFixed(2)} stdev=${sd.toFixed(2)} ` +
              `divergence=${divergenceLevel} n=${activeValues.length}  [${summary}]`);

  // R23 #6: consensus_regression event when stdev rises >0.3 vs prior round.
  // Distinct from one-round high-divergence: this catches ACCELERATION.
  try {
    const tsPath = path.join(METRICS_DIR, 'hme-arc-timeseries.jsonl');
    if (fs.existsSync(tsPath)) {
      const tsLines = fs.readFileSync(tsPath, 'utf8').split('\n').filter(Boolean);
      if (tsLines.length >= 1) {
        const prevRow = JSON.parse(tsLines[tsLines.length - 1]);
        const prevStdev = prevRow && prevRow.arc_i ? prevRow.arc_i.stdev : null;
        if (typeof prevStdev === 'number' && (sd - prevStdev) > 0.3) {
          const { spawn } = require('child_process');
          try {
            spawn('python3', [
              path.join(ROOT, 'tools', 'HME', 'activity', 'emit.py'),
              '--event=consensus_regression',
              `--stdev_cur=${sd.toFixed(3)}`,
              `--stdev_prev=${prevStdev.toFixed(3)}`,
              `--delta=${(sd - prevStdev).toFixed(3)}`,
              '--session=pipeline',
            ], { stdio: 'ignore', detached: true, cwd: ROOT,
                 env: Object.assign({}, process.env, { PROJECT_ROOT: ROOT }) }).unref();
          } catch (_re) { /* best-effort */ }
        }
      }
    }
  } catch (_tse) { /* best-effort */ }

  // R23 #5: axis_cost_trend forecaster -- linear extrapolation from
  try {
    const tsPath = path.join(METRICS_DIR, 'hme-arc-timeseries.jsonl');
    if (fs.existsSync(tsPath)) {
      const tsLines = fs.readFileSync(tsPath, 'utf8').split('\n').filter(Boolean);
      const tsRows = tsLines.map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } }).filter(Boolean);
      const trail = tsRows.slice(-3);
      // voter data isn't in timeseries; we have mean + stdev. Use mean decline
      // as the proxy for consensus deterioration pace.
      const means = trail.map((r) => (r.arc_i && r.arc_i.mean)).filter((x) => typeof x === 'number');
      means.push(m);
      if (means.length >= 3) {
        // simple linear slope: (last - first) / (n-1)
        const slope = (means[means.length - 1] - means[0]) / (means.length - 1);
        if (slope < -0.05) {
          // how many rounds until mean hits -0.3?
          const target = -0.3;
          const roundsToTarget = Math.ceil((target - means[means.length - 1]) / slope);
          record.forecast = {
            consensus_mean_slope_per_round: Number(slope.toFixed(3)),
            rounds_to_significant_decline: roundsToTarget > 0 ? roundsToTarget : null,
          };
        }
      }
    }
  } catch (_fe) { /* best-effort */ }

  // R23 #9: harvester action acted-on accounting. For each previous round's
  try {
    const { execSync } = require('child_process');
    const naPath = path.join(METRICS_DIR, 'hme-next-actions.json');
    if (fs.existsSync(naPath)) {
      const naData = JSON.parse(fs.readFileSync(naPath, 'utf8'));
      const prevIds = (naData.actions || []).map((a) => a.id).filter(Boolean);
      const log = execSync('git log -30 --pretty=%s%n%b', { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
      const hit = prevIds.filter((id) => log.toLowerCase().includes(id.toLowerCase()));
      record.harvester_previous_round_ids = prevIds;
      record.harvester_acted_on_count = hit.length;
    }
  } catch (_harv) { /* best-effort */ }

  // (write record again with any additions from above blocks)
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');

  // Emit consensus_divergence activity event when stdev crosses threshold.
  if (sd > DIVERGENCE_THRESHOLD) {
    const { spawn } = require('child_process');
    try {
      spawn('python3', [
        path.join(ROOT, 'tools', 'HME', 'activity', 'emit.py'),
        '--event=consensus_divergence',
        `--stdev=${sd.toFixed(3)}`,
        `--mean=${m.toFixed(3)}`,
        `--outlier_count=${outliers.length}`,
        `--outliers=${outliers.map((o) => o.voter).join(',')}`,
        '--session=pipeline',
      ], { stdio: 'ignore', detached: true, cwd: ROOT,
           env: Object.assign({}, process.env, { PROJECT_ROOT: ROOT }) }).unref();
    } catch (_e) { /* best-effort */ }
  }
}

main();
