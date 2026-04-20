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

  // Identify outliers: voters >1.5 stdev from mean.
  const outliers = activeVoters
    .filter(([, v]) => Math.abs(v - m) > 1.5 * sd)
    .map(([name, v]) => ({ voter: name, score: Number(v.toFixed(3)), delta_from_mean: Number((v - m).toFixed(3)) }));

  let divergenceLevel = 'low';
  if (sd > DIVERGENCE_THRESHOLD) divergenceLevel = 'high';
  else if (sd > DIVERGENCE_THRESHOLD / 2) divergenceLevel = 'moderate';

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
    outliers: outliers,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');

  const summary = activeVoters
    .map(([n, v]) => `${n.split('_')[0]}=${v.toFixed(2)}`)
    .join(' ');
  console.log(`compute-consensus: mean=${m.toFixed(2)} stdev=${sd.toFixed(2)} ` +
              `divergence=${divergenceLevel} n=${activeValues.length}  [${summary}]`);

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
