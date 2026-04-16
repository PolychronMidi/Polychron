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

const PREDICTIONS = path.join(ROOT, 'metrics', 'hme-predictions.jsonl');
const FINGERPRINT = path.join(ROOT, 'metrics', 'fingerprint-comparison.json');
const ACCURACY_OUT = path.join(ROOT, 'metrics', 'hme-prediction-accuracy.json');
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

function extractShiftedModules(fingerprint) {
  // fingerprint-comparison.json shape varies by pipeline version. Try a few
  // known structures:
  //   { verdict, changes: [{ field: 'trustWeight.motifEcho', ... }, ...] }
  //   { verdict, deltas: { 'motifEcho': {weight: 0.1}, ... } }
  //   { verdict, trust: { 'motifEcho': 0.1, ... } }
  if (!fingerprint || typeof fingerprint !== 'object') return new Set();
  const shifted = new Set();
  const pushFromKey = (k) => {
    if (typeof k !== 'string') return;
    // Extract the trailing module stem from dotted keys like "trust.motifEcho"
    const parts = k.split(/[.:/]/);
    const tail = parts[parts.length - 1];
    if (tail && /^[a-zA-Z][a-zA-Z0-9]*$/.test(tail)) shifted.add(tail);
  };
  if (Array.isArray(fingerprint.changes)) {
    for (const c of fingerprint.changes) {
      if (c && c.field) pushFromKey(c.field);
      if (c && c.module) pushFromKey(c.module);
      if (c && c.path) pushFromKey(c.path);
    }
  }
  if (fingerprint.deltas && typeof fingerprint.deltas === 'object') {
    for (const k of Object.keys(fingerprint.deltas)) pushFromKey(k);
  }
  if (fingerprint.trust && typeof fingerprint.trust === 'object') {
    for (const k of Object.keys(fingerprint.trust)) pushFromKey(k);
  }
  if (Array.isArray(fingerprint.shifted_modules)) {
    for (const m of fingerprint.shifted_modules) pushFromKey(m);
  }
  return shifted;
}

function main() {
  const predictions = loadPredictions();
  const fingerprint = loadJson(FINGERPRINT);
  const history = loadJson(ACCURACY_OUT) || { meta: {}, rounds: [], ema: null };

  if (predictions.length === 0) {
    console.log('reconcile-predictions: no predictions logged this round -- skipping');
    return;
  }

  const shifted = extractShiftedModules(fingerprint);

  // Phase 6.1 -- split predictions into clean (prediction made post-hoc,
  // with no proxy injection in the loop) vs injected (prediction surfaced
  // to the Evolver before the edit). Clean predictions are a true test of
  // the cascade model; injected ones are influence (self-fulfilling).
  const cleanPredicted = new Set();
  const injectedPredicted = new Set();
  for (const p of predictions) {
    const target = p.injected ? injectedPredicted : cleanPredicted;
    for (const m of p.predicted || []) target.add(m);
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
  const accuracy = total > 0 ? confirmed.length / total : null;

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
    predictions_total: predictions.length,
    predicted_modules: Array.from(predictedAll),
    shifted_modules: Array.from(shifted),
    confirmed,
    refuted,
    missed,
    accuracy: accuracy !== null ? Number(accuracy.toFixed(4)) : null,
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

  // Truncate predictions log so the next round starts fresh. Keep the last
  // 200 lines as trailing history for debugging.
  try {
    const raw = fs.readFileSync(PREDICTIONS, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const keep = lines.slice(-200);
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
