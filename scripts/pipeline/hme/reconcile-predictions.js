// scripts/pipeline/reconcile-predictions.js
//
// Phase 3.4 -- post-pipeline reconciler that compares cascade predictions
// logged during the session against the actual fingerprint delta produced
// by the pipeline run.
//
// Reads:
//   metrics/hme-predictions.jsonl         (append-only prediction log from
//                                          cascade_analysis._log_prediction)
//   metrics/fingerprint-comparison.json   (the round's actual deltas)
//
// For each prediction, computes:
//   - confirmed  = predicted modules that shifted above threshold in actuals
//   - refuted    = predicted modules that did NOT shift
//   - missed     = modules that shifted but were not in any prediction
// Then updates `metrics/hme-prediction-accuracy.json` with an exponential
// moving average of accuracy across rounds.
//
// Writes a per-round record to the accuracy file (capped to last 50 rounds).
// Non-fatal -- produces a diagnostic, doesn't gate the pipeline.

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJson, loadJsonl, clamp } = require('./utils');
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');

const PREDICTIONS = path.join(METRICS_DIR, 'hme-predictions.jsonl');
const FINGERPRINT = path.join(METRICS_DIR, 'fingerprint-comparison.json');
const ACCURACY_OUT = path.join(METRICS_DIR, 'hme-prediction-accuracy.json');
const EMA_ALPHA = 0.2; // 20% weight on newest round, 80% on history
const HISTORY_CAP = 50;


function loadPredictions() {
  if (!fs.existsSync(PREDICTIONS)) return [];
  const raw = fs.readFileSync(PREDICTIONS, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (_e) { /* skip corrupt */ }
  }
  return out;
}

function extractShiftedModules() {
  // Use git diff to find actually-changed source modules this round.
  // fingerprint-comparison.json tracks acoustic dimensions (pitchEntropy etc.),
  // not code modules -- it can't tell us which JS modules were edited.
  // Git diff gives us the ground truth: which src/ files changed in the last
  // 2 commits (generate-predictions runs before the commit, so we look back 2).
  const { execSync } = require('child_process');
  const shifted = new Set();
  const toModule = (p) => {
    const base = require('path').basename(p);
    return base.replace(/\.(js|ts|py|sh)$/, '');
  };
  // Try last 2 commits first, fall back to last 1 (for first-commit edge case)
  for (const range of ['HEAD~2..HEAD', 'HEAD~1..HEAD', 'HEAD']) {
    try {
      const out = execSync(`git diff --name-only ${range} -- src/`, {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      if (out) {
        for (const line of out.split('\n')) {
          if (line.trim()) shifted.add(toModule(line.trim()));
        }
      }
      if (shifted.size > 0) break;
    } catch (_e) { /* git not available or range invalid */ }
  }
  return shifted;
}

function main() {
  const predictions = loadPredictions();
  const fingerprint = loadJson(FINGERPRINT);
  const history = loadJson(ACCURACY_OUT) || { meta: {}, rounds: [], ema: null };

  if (predictions.length === 0) {
    console.log('reconcile-predictions: no predictions logged -- skipping');
    return;
  }

  const shifted = extractShiftedModules();

  // R13: Only score predictions from THIS round. Previously every prediction
  // in the jsonl (accumulated across 200-record truncation window = ~10 past
  // rounds) was compared against current round's git diff, producing wildly
  // over-weighted refuted counts. A prediction made 5 rounds ago for a
  // different commit shouldn't score against this commit's changes.
  //
  // Current-round window: predictions whose ts is >= the most recent
  // round_complete's ts in the activity log. Falls back to "last 30 minutes"
  // if the activity log is unavailable (prevents accidental full-history scan).
  const CURRENT_ROUND_WINDOW_MS = 30 * 60 * 1000;
  let windowStart = Date.now() - CURRENT_ROUND_WINDOW_MS;
  try {
    const activityPath = path.join(METRICS_DIR, 'hme-activity.jsonl');
    if (fs.existsSync(activityPath)) {
      const raw = fs.readFileSync(activityPath, 'utf8');
      const lines = raw.split('\n').reverse();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.event === 'round_complete' && e.verdict && e.ts) {
            // Prior round's round_complete marks the start of THIS round's window.
            // Since this reconcile runs inside the new round but before that
            // round_complete fires, the most recent verdict-bearing round_complete
            // is the prior round's.
            windowStart = Number(e.ts) * 1000;
            break;
          }
        } catch (_e2) { /* skip malformed */ }
      }
    }
  } catch (_e) { /* fall through to 30min default */ }

  const currentRoundPredictions = predictions.filter((p) => {
    if (!p.ts) return false;
    const predTs = Date.parse(p.ts);
    return Number.isFinite(predTs) && predTs >= windowStart;
  });

  // Phase 6.1 -- split predictions into clean vs injected.
  const cleanPredicted = new Set();
  const injectedPredicted = new Set();
  for (const p of currentRoundPredictions) {
    const target = p.injected ? injectedPredicted : cleanPredicted;
    for (const m of p.predicted || p.affected_modules || []) target.add(m);
  }
  const predictedAll = new Set([...cleanPredicted, ...injectedPredicted]);

  // Classification -- single aggregate view
  const confirmed = [];
  const refuted = [];
  for (const m of predictedAll) {
    if (shifted.has(m)) confirmed.push(m);
    else refuted.push(m);
  }
  const missed = [];
  for (const m of shifted) {
    if (!predictedAll.has(m)) missed.push(m);
  }

  // Per-lineage classification
  function classifyBucket(predictedSet) {
    const c = [];
    const r = [];
    for (const m of predictedSet) {
      if (shifted.has(m)) c.push(m);
      else r.push(m);
    }
    const t = c.length + r.length;
    return {
      confirmed: c.length,
      refuted: r.length,
      total: t,
      accuracy: t > 0 ? Number((c.length / t).toFixed(4)) : null,
    };
  }
  const cleanBucket = classifyBucket(cleanPredicted);
  const injectedBucket = classifyBucket(injectedPredicted);

  const total = confirmed.length + refuted.length;
  // R17 #2: Accuracy vs recall trade-off -- intentional asymmetry.
  //   accuracy (precision) = confirmed / (confirmed + refuted)
  //   recall              = confirmed / shifted
  // depth-1 predictions include ALL direct consumers of the edited file.
  // Typically only a subset get edited in the same round, so `refuted` count
  // stays moderate (4-15 per edit) while `recall` should hit 1.0 when the
  // cascade direction is correct. Low recall = structural bug (fixed R14);
  // low accuracy = normal over-prediction that reflects dependency breadth,
  // NOT a cascade bug. Target: recall >= 0.8, accuracy >= 0.3.
  // R15 #9: When no modules shifted this round, predictions can't be scored --
  // refuted count is misleading (those predictions may be valid, just untested
  // this round). Flag as skipped so metrics aren't polluted by untestable zeros.
  const shiftedCount = shifted.size;
  const skipped = shiftedCount === 0;
  const accuracy = skipped ? null : (total > 0 ? confirmed.length / total : null);
  // Recall: fraction of actually-shifted modules that were predicted.
  const recall = skipped ? null : (shiftedCount > 0 ? confirmed.length / shiftedCount : null);

  // EMA update
  const prevEma = typeof history.ema === 'number' ? history.ema : null;
  let newEma;
  if (accuracy === null) {
    newEma = prevEma;
  } else if (prevEma === null) {
    newEma = accuracy;
  } else {
    newEma = prevEma * (1 - EMA_ALPHA) + accuracy * EMA_ALPHA;
  }

  // Phase 6.1 -- reflexivity ratio: what fraction of this round's
  // predicted modules came from INJECTED (contaminated) predictions?
  const reflexivityRatio =
    predictedAll.size > 0
      ? Number((injectedPredicted.size / predictedAll.size).toFixed(4))
      : 0;

  const roundRecord = {
    timestamp: new Date().toISOString(),
    skipped: skipped,
    skipped_reason: skipped ? 'no_src_shifts_this_round' : null,
    predictions_total: currentRoundPredictions.length,
    predictions_log_size: predictions.length,  // historical: total in jsonl
    predicted_modules: Array.from(predictedAll),
    shifted_modules: Array.from(shifted),
    confirmed,
    refuted,
    missed,
    accuracy: accuracy !== null ? Number(accuracy.toFixed(4)) : null,
    recall: recall !== null ? Number(recall.toFixed(4)) : null,
    ema_after: newEma !== null ? Number(newEma.toFixed(4)) : null,
    // Phase 6.1 reflexivity breakdown
    clean_bucket: cleanBucket,
    injected_bucket: injectedBucket,
    reflexivity_ratio: reflexivityRatio,
  };

  const rounds = Array.isArray(history.rounds) ? history.rounds.slice(-HISTORY_CAP + 1) : [];
  rounds.push(roundRecord);

  const updated = {
    meta: {
      script: 'reconcile-predictions.js',
      updated: new Date().toISOString(),
      ema_alpha: EMA_ALPHA,
      history_cap: HISTORY_CAP,
    },
    ema: newEma !== null ? Number(newEma.toFixed(4)) : null,
    rounds,
  };

  fs.mkdirSync(path.dirname(ACCURACY_OUT), { recursive: true });
  fs.writeFileSync(ACCURACY_OUT, JSON.stringify(updated, null, 2) + '\n');

  // Feed missed modules back as learning signal: append them to the predictions
  // log tagged source=missed_prediction so future reconcile rounds can track
  // whether the cascade model learns to predict these over time.
  if (missed.length > 0) {
    try {
      const missedRecord = JSON.stringify({
        ts: new Date().toISOString(),
        target_module: '_missed_feedback',
        affected_modules: missed,
        affected_count: missed.length,
        injected: false,
        source: 'missed_prediction',
      });
      fs.appendFileSync(PREDICTIONS, missedRecord + '\n');
    } catch (_e) { /* best-effort */ }
  }

  // Truncate predictions log so the next round starts fresh. Cap at 50 lines
  // -- previously 200 but with depth=1 producing ~2-5 records per round, that's
  // 20-40 rounds of history. predictions-log-gap-bounded requires gap<100, so
  // 50 keeps us well under (and still enough for debug traceback across a
  // handful of rounds).
  const LOG_CAP = 50;
  try {
    const raw = fs.readFileSync(PREDICTIONS, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const keep = lines.slice(-LOG_CAP);
    fs.writeFileSync(PREDICTIONS, keep.join('\n') + '\n');
  } catch (_e) { /* ignore */ }

  const accPct = accuracy !== null ? (accuracy * 100).toFixed(1) + '%' : 'n/a';
  const emaPct = newEma !== null ? (newEma * 100).toFixed(1) + '%' : 'n/a';
  console.log(
    `reconcile-predictions: accuracy ${accPct}  EMA ${emaPct}  ` +
      `(${confirmed.length} confirmed, ${refuted.length} refuted, ${missed.length} missed)`,
  );
}

main();
