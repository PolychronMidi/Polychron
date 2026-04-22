// scripts/pipeline/compute-coherence-budget.js
//
// Phase 5.2 -- coherence budget (homeostatic governance).
//
// Based on the Phase 5 thesis: HME maximizing coherence may suppress the
// productive chaos that generates musical emergence. Instead of optimizing
// the coherence score toward 1.0, we compute an *optimal band* derived
// from history -- the coherence range at which rounds actually produced
// strong musical outcomes -- and report whether the current round sits in
// the band, above it (too disciplined), or below it (too chaotic).
//
// Algorithm:
//   1. Read metrics/hme-musical-correlation.json history.
//   2. Rank rounds by a composite "musical outcome" score = 0.5*
//      perceptual_complexity_avg + 0.3*clap_tension + 0.2*verdict_numeric.
//   3. Take the top quartile -- those are the "good rounds".
//   4. The optimal coherence band = [min, max] of `hme_coherence` in
//      those good rounds.
//   5. If history is too short (< 8 rounds), fall back to prior [0.55, 0.85].
//
// Output: metrics/hme-coherence-budget.json
//   { band: [low, high], current_coherence, state, prescription, history }
//
// state = BELOW | OPTIMAL | ABOVE | INSUFFICIENT_DATA
// prescription = specific guidance for the proxy (inject MORE or LESS)
//
// The proxy reads this file and adjusts its injection aggressiveness:
//   - BELOW    -> inject forcefully (KB context + bias bounds + hypotheses)
//   - OPTIMAL  -> normal injection
//   - ABOVE    -> relaxed injection (skip non-critical warnings, flag round
//                as "emergence-licensed", allow writes into low-coverage
//                territory without coherence_violation emission)
//
// Runs as a POST_COMPOSITION step after compute-musical-correlation.js.
// Non-fatal.

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJson, loadJsonl, clamp } = require('./utils');
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');

const MUSICAL = path.join(METRICS_DIR, 'hme-musical-correlation.json');
const COHERENCE = path.join(METRICS_DIR, 'hme-coherence.json');
const GROUND_TRUTH = path.join(METRICS_DIR, 'hme-ground-truth.jsonl');
const OUT = path.join(METRICS_DIR, 'hme-coherence-budget.json');

const MIN_HISTORY = 8;
const PRIOR_BAND = [0.55, 0.85];
const HISTORY_CAP = 60;

// Sentiment -> scalar in [0, 1]. Ground truth dominates the outcome score
// when present so that the proxy's "emergence suppressed" reflex can't
// fire on a round the listener actually reports as transcendent.
const SENTIMENT_WEIGHT = {
  transcendent: 1.0,
  compelling: 0.9,
  moving: 0.8,
  surprising: 0.7,
  earned: 0.7,
  mechanical: 0.3,
  flat: 0.2,
  misfire: 0.0,
};
const POSITIVE_SENTIMENTS = new Set(['transcendent', 'compelling', 'moving', 'surprising', 'earned']);


function loadGroundTruth() {
  // Returns { byRound: { R92: {sentiment, moment_type, ts}, ... }, latest: {...}|null }
  if (!fs.existsSync(GROUND_TRUTH)) return { byRound: {}, latest: null };
  const byRound = {};
  let latest = null;
  let latestTs = 0;
  const lines = fs.readFileSync(GROUND_TRUTH, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch (_e) { continue; }
    const tag = row.round_tag || '';
    const ts = Number(row.ts) || 0;
    if (!tag) continue;
    // Prefer the latest entry per round (listeners sometimes amend).
    const prior = byRound[tag];
    if (!prior || ts >= prior.ts) {
      byRound[tag] = {
        sentiment: row.sentiment || null,
        moment_type: row.moment_type || null,
        section: row.section || null,
        ts,
        comment: row.comment || '',
      };
    }
    if (ts >= latestTs) {
      latestTs = ts;
      latest = { round_tag: tag, ...byRound[tag] };
    }
  }
  return { byRound, latest };
}

function groundTruthScalar(entry) {
  // Map a ground-truth entry to [0, 1] via sentiment weights.
  if (!entry || !entry.sentiment) return null;
  const s = String(entry.sentiment).toLowerCase();
  if (s in SENTIMENT_WEIGHT) return SENTIMENT_WEIGHT[s];
  return null;
}

function musicalOutcomeScore(snapshot, groundTruth) {
  // Composite scalar in ~[0, 1.1].
  //
  // When ground truth exists for the snapshot's round, it DOMINATES
  // (weight 0.6) because a listener's transcendent verdict is stronger
  // signal than perceptual proxies. Without ground truth, fall back to
  // the original EnCodec/CLAP/verdict composite.
  let score = 0;
  let weights = 0;
  const gtScalar = groundTruthScalar(groundTruth);
  if (gtScalar !== null) {
    score += 0.6 * gtScalar;
    weights += 0.6;
  }
  if (typeof snapshot.perceptual_complexity_avg === 'number') {
    score += 0.2 * snapshot.perceptual_complexity_avg;
    weights += 0.2;
  }
  if (typeof snapshot.clap_tension === 'number') {
    // CLAP similarity scores are typically 0..0.3 -- rescale
    score += 0.1 * Math.min(1, snapshot.clap_tension * 3);
    weights += 0.1;
  }
  if (typeof snapshot.verdict_numeric === 'number') {
    score += 0.1 * snapshot.verdict_numeric;
    weights += 0.1;
  }
  return weights > 0 ? score / weights : null;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Match a musical-correlation snapshot to the ground-truth entry most
// likely to describe it. Ground truth is emitted shortly AFTER the
// pipeline run, so we pick the GT entry whose ts is the smallest
// positive delta from the snapshot within a 6-hour window.
function matchGroundTruthForSnapshot(snapshotTsIso, groundTruthLatestByTs) {
  const snapTs = Date.parse(snapshotTsIso) / 1000;
  if (!Number.isFinite(snapTs)) return null;
  const WINDOW_S = 6 * 3600;
  let best = null;
  for (const entry of groundTruthLatestByTs) {
    const delta = entry.ts - snapTs;
    if (delta >= -600 && delta <= WINDOW_S) {
      if (!best || delta < best.delta) {
        best = { entry, delta };
      }
    }
  }
  return best ? best.entry : null;
}

function main() {
  const musical = loadJson(MUSICAL);
  const coherence = loadJson(COHERENCE);
  const currentCoherence =
    coherence && typeof coherence.score === 'number' ? coherence.score : null;

  const gt = loadGroundTruth();
  // Sort ground truth by ts ascending for matchGroundTruthForSnapshot().
  const gtSorted = Object.values(gt.byRound).sort((a, b) => a.ts - b.ts);

  const history = (musical && Array.isArray(musical.history)) ? musical.history : [];
  const scored = history
    .map((s) => {
      const snapGt = matchGroundTruthForSnapshot(s.timestamp, gtSorted);
      return {
        ts: s.timestamp,
        coherence: s.hme_coherence,
        outcome: musicalOutcomeScore(s, snapGt),
        ground_truth: snapGt,
      };
    })
    .filter((x) => typeof x.coherence === 'number' && typeof x.outcome === 'number');

  let band;
  let bandSource;
  let bandRounds = 0;

  if (scored.length < MIN_HISTORY) {
    band = PRIOR_BAND.slice();
    bandSource = `prior (${scored.length}/${MIN_HISTORY} rounds -- using default)`;
  } else {
    // Sort by outcome descending and take top quartile (at least 2)
    const sortedByOutcome = scored.slice().sort((a, b) => b.outcome - a.outcome);
    const topN = Math.max(2, Math.floor(scored.length * 0.25));
    const topRounds = sortedByOutcome.slice(0, topN);
    const coherencesInTop = topRounds.map((r) => r.coherence).sort((a, b) => a - b);
    const lo = quantile(coherencesInTop, 0.25);
    const hi = quantile(coherencesInTop, 0.75);
    // Ensure non-degenerate band
    if (lo === hi) {
      band = [Math.max(0, lo - 0.1), Math.min(1, hi + 0.1)];
    } else {
      band = [lo, hi];
    }
    bandSource = `derived from top-quartile rounds`;
    bandRounds = topN;
  }

  // Find the ground truth that belongs to the CURRENT round (latest
  // snapshot) if one exists. This is what drives the override.
  const latestSnapTs = history.length ? history[history.length - 1].timestamp : null;
  const currentGt = latestSnapTs ? matchGroundTruthForSnapshot(latestSnapTs, gtSorted) : null;
  const currentGtPositive = currentGt && POSITIVE_SENTIMENTS.has(
    String(currentGt.sentiment || '').toLowerCase()
  );

  // Classify current state
  let state, prescription;
  let groundTruthOverride = null;
  if (currentCoherence === null) {
    state = 'INSUFFICIENT_DATA';
    prescription = 'wait for at least one coherence score';
  } else if (currentCoherence < band[0]) {
    state = 'BELOW';
    prescription = (
      'TIGHTEN: coherence below optimal band. Proxy should inject forcefully -- ' +
      'KB context, bias bounds, and open hypotheses for every write target.'
    );
  } else if (currentCoherence > band[1]) {
    state = 'ABOVE';
    if (currentGtPositive) {
      // Ground truth dominates: listener reports the round is good, so
      // "emergence suppressed" is the wrong diagnosis. Maintain the
      // current disciplined regime and flag the band for recalibration.
      prescription = (
        `CONFIRMED: coherence above prior band but ground truth = ` +
        `${currentGt.sentiment}/${currentGt.moment_type || 'unspecified'} ` +
        `(${currentGt.round_tag || 'latest'}). Maintain the current regime. ` +
        `The band [${(band[0] * 100).toFixed(0)}%, ${(band[1] * 100).toFixed(0)}%] ` +
        `is a prior; recalibrate once ${MIN_HISTORY}+ rounds accumulate.`
      );
      groundTruthOverride = {
        round_tag: currentGt.round_tag || null,
        sentiment: currentGt.sentiment,
        moment_type: currentGt.moment_type,
        comment: currentGt.comment,
        action: 'CONFIRMED',
      };
    } else {
      prescription = (
        'RELAX: coherence above optimal band. System may be too disciplined -- ' +
        'emergence suppressed. Proxy should skip non-critical warnings, ' +
        'flag round as emergence-licensed, allow writes into low-coverage ' +
        'territory without penalizing as incoherence.'
      );
    }
  } else {
    state = 'OPTIMAL';
    prescription = 'NORMAL: coherence in optimal band. Continue standard injection.';
  }

  // Append to history
  const prev = loadJson(OUT);
  const prevHistory = Array.isArray(prev && prev.history) ? prev.history : [];
  const newHistory = prevHistory.concat([{
    timestamp: new Date().toISOString(),
    coherence: currentCoherence,
    band,
    state,
    ground_truth_override: groundTruthOverride ? groundTruthOverride.action : null,
  }]).slice(-HISTORY_CAP);

  const report = {
    meta: {
      script: 'compute-coherence-budget.js',
      timestamp: new Date().toISOString(),
      musical_rounds_scored: scored.length,
      band_source: bandSource,
      band_derived_from_rounds: bandRounds,
      ground_truth_rounds: Object.keys(gt.byRound).length,
    },
    band: [Number(band[0].toFixed(4)), Number(band[1].toFixed(4))],
    current_coherence: currentCoherence,
    state,
    prescription,
    ground_truth_override: groundTruthOverride,
    history: newHistory,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  const coh_s = currentCoherence !== null ? `${(currentCoherence * 100).toFixed(0)}%` : 'n/a';
  const band_s = `[${(band[0] * 100).toFixed(0)}% - ${(band[1] * 100).toFixed(0)}%]`;
  console.log(
    `compute-coherence-budget: ${state}  coh=${coh_s}  band=${band_s}  (${bandSource})`,
  );
}

main();
