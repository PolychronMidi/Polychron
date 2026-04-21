// scripts/pipeline/hme/compute-consensus.js
//
// Arc I: Cross-Substrate Consensus.
//
// Seven observability substrates (HCI verifiers, invariant battery, prediction
// cascade, fingerprint verdict, axis rebalance cost, CLAP perceptual, user
// listening verdict) independently judge each pipeline round. They've coexisted
// without ever computing a shared opinion. This script does.
//
// For every available substrate, compute a bounded scalar in [-1, +1]:
//   +1  = substrate asserts "healthy"
//    0  = substrate neutral / insufficient data
//   -1  = substrate asserts "broken"
//
// The mean across substrates is the consensus score. The stdev is the
// divergence signal -- high stdev means substrates DISAGREE, which is often
// more actionable than any individual substrate's verdict (it surfaces
// hidden tensions in the measurement stack).
//
// Writes metrics/hme-consensus.json per round + emits consensus_divergence
// activity event when stdev exceeds threshold.
//
// Non-fatal. Runs after compute-musical-correlation + reconcile-predictions.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'metrics', 'hme-consensus.json');
const DIVERGENCE_THRESHOLD = 0.4;  // stdev above this triggers divergence alert

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_e) { return null; }
}

// Clamp helper -- bounds a scalar to [-1, +1].
function clamp1(x) { return Math.max(-1, Math.min(1, x)); }

// ---- voters ----

// HCI voter: 0-100 scale mapped to [-1, +1] using 80 as neutral point.
// hci=80 -> 0, hci=100 -> +1, hci=60 -> -1.
function voteHci() {
  const summary = loadJson(path.join(ROOT, 'metrics', 'pipeline-summary.json'));
  if (!summary || typeof summary.hci !== 'number') return null;
  return clamp1((summary.hci - 80) / 20);
}

// Invariant battery voter: pass-rate in [0, 1] mapped to [-1, +1].
// 90% pass = 0 (neutral), 95% = +1, 85% = -1. Tight band because the battery
// regularly sits at 95%+ -- small drops are meaningful signal.
function voteInvariants() {
  const hist = loadJson(path.join(ROOT, 'metrics', 'hme-invariant-history.json'));
  if (!hist || !hist.last_result) return null;
  const results = Object.values(hist.last_result);
  if (results.length === 0) return null;
  const pass = results.filter((v) => v === 'pass').length;
  const rate = pass / results.length;
  return clamp1(2 * (rate - 0.90) / 0.10);
}

// Prediction recall voter: [0, 1] -> [-1, +1]. Skipped rounds return null.
function votePredictionRecall() {
  const acc = loadJson(path.join(ROOT, 'metrics', 'hme-prediction-accuracy.json'));
  if (!acc || !Array.isArray(acc.rounds) || acc.rounds.length === 0) return null;
  const last = acc.rounds[acc.rounds.length - 1];
  if (last.skipped || typeof last.recall !== 'number') return null;
  return clamp1(2 * last.recall - 1);
}

// Verdict numeric voter: STABLE=1 -> +1, EVOLVED=1.1 -> +1, DRIFTED=0 -> -1.
// Uses the most recent musical-correlation snapshot.
function voteVerdict() {
  const mc = loadJson(path.join(ROOT, 'metrics', 'hme-musical-correlation.json'));
  if (!mc || !Array.isArray(mc.history) || mc.history.length === 0) return null;
  const last = mc.history[mc.history.length - 1];
  if (typeof last.verdict_numeric !== 'number') return null;
  // Map 0 (DRIFTED) -> -1, 0.5 (UNKNOWN) -> 0, 1 (STABLE) -> +1, 1.1 (EVOLVED) -> +1.
  return clamp1(2 * last.verdict_numeric - 1);
}

// Axis rebalance cost trend voter: stable cost = 0, rising >50% over 3 rounds = -1.
function voteAxisCostTrend() {
  const histPath = path.join(ROOT, 'metrics', 'legacy-override-history.jsonl');
  if (!fs.existsSync(histPath)) return null;
  const rows = fs.readFileSync(histPath, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } })
    .filter(Boolean);
  if (rows.length < 3) return null;
  const tail = rows.slice(-3);
  const costs = tail.map((r) => {
    const total = Object.values(r.per_axis_adj || {})
      .reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return r.beat_count > 0 ? (total / r.beat_count) * 100 : null;
  }).filter((c) => c !== null);
  if (costs.length < 3 || costs[0] <= 0) return null;
  const growth = (costs[costs.length - 1] - costs[0]) / costs[0];
  // growth=0 -> 0, growth=+0.5 (+50%) -> -1, growth=-0.5 (-50%) -> +1 (falling is good).
  return clamp1(-growth / 0.5);
}

// CLAP stability voter: check perceptual-report for CLAP tension.
// If tension stays within [0.2, 0.6] band, +1; outside -> proportionally lower.
function voteClapStability() {
  const perc = loadJson(path.join(ROOT, 'metrics', 'perceptual-report.json'));
  const clap = perc && perc.clap && perc.clap.queries;
  if (!clap) return null;
  const tensionKey = Object.keys(clap).find((k) => /tension/i.test(k));
  const peak = tensionKey && typeof clap[tensionKey].peak === 'number'
    ? clap[tensionKey].peak : null;
  if (peak === null) return null;
  // In-band [0.2, 0.6] -> +1; further outside -> lower.
  const mid = 0.4;
  const halfBand = 0.2;
  const dist = Math.abs(peak - mid);
  if (dist <= halfBand) return 1;
  return clamp1(1 - (dist - halfBand) / halfBand * 2);
}

// User listening verdict voter: reads metrics/hme-ground-truth.jsonl if present,
// scoring the most recent entry. legendary=+1, stable=+0.5, drifted=-0.5, broken=-1.
// Returns null if no ground truth recorded (most common case -- user only records
// occasional verdicts, not every round).
function voteListeningVerdict() {
  const gtPath = path.join(ROOT, 'metrics', 'hme-ground-truth.jsonl');
  if (!fs.existsSync(gtPath)) return null;
  const lines = fs.readFileSync(gtPath, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  const last = (() => { try { return JSON.parse(lines[lines.length - 1]); }
                        catch (_e) { return null; } })();
  if (!last) return null;
  const sentiment = (last.tags || []).map((t) => String(t).toLowerCase());
  if (sentiment.includes('legendary')) return 1;
  if (sentiment.includes('stable') || sentiment.includes('good')) return 0.5;
  if (sentiment.includes('drifted') || sentiment.includes('degraded')) return -0.5;
  if (sentiment.includes('broken') || sentiment.includes('bad')) return -1;
  return null;
}

// ---- main ----

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
  // per voter across the last 5 timeseries rows (plus current round).
  // Trajectory-aware consensus -- single-round outliers get damped; sustained
  // outliers persist. Arc I v2.
  const voterTrajectories = {};
  try {
    const tsPath = path.join(ROOT, 'metrics', 'hme-arc-timeseries.jsonl');
    if (fs.existsSync(tsPath)) {
      // Timeseries doesn't carry per-voter scalars (just outlier_voters array).
      // For trajectory, we'd need to either (a) re-emit per-voter scalars in
      // timeseries, or (b) store running history in consensus JSON itself.
      // Choose (b): per-voter history written into hme-consensus-history.jsonl.
      const histPath = path.join(ROOT, 'metrics', 'hme-consensus-history.jsonl');
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
  // When the EXTERNAL ground truth (listening verdict = legendary) + HCI >= 95
  // for 3+ consecutive rounds, internal substrate divergence is STRUCTURALLY
  // INTERESTING but practically irrelevant. The substrate's disagreements
  // about HOW composition is healthy don't override the USER saying it IS
  // healthy. Override divergence level to "low" in this case; keep the raw
  // stdev + outliers so investigation still surfaces the signal.
  let overrideApplied = false;
  try {
    const gtPath = path.join(ROOT, 'metrics', 'hme-ground-truth.jsonl');
    const sumPath = path.join(ROOT, 'metrics', 'pipeline-summary.json');
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
    const tsPath = path.join(ROOT, 'metrics', 'hme-arc-timeseries.jsonl');
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
  // history. If voter has been declining, estimate rounds until it
  // reaches -0.5 (significant negative). Tiny forecaster; writes to
  // the consensus record.
  try {
    const tsPath = path.join(ROOT, 'metrics', 'hme-arc-timeseries.jsonl');
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
  // action ids in hme-next-actions.json, check whether the commit between
  // now and that round mentions the id. If any do, increment "acted_on".
  try {
    const { execSync } = require('child_process');
    const naPath = path.join(ROOT, 'metrics', 'hme-next-actions.json');
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
