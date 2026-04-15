// scripts/pipeline/compute-coherence-budget.js
//
// Phase 5.2 — coherence budget (homeostatic governance).
//
// Based on the Phase 5 thesis: HME maximizing coherence may suppress the
// productive chaos that generates musical emergence. Instead of optimizing
// the coherence score toward 1.0, we compute an *optimal band* derived
// from history — the coherence range at which rounds actually produced
// strong musical outcomes — and report whether the current round sits in
// the band, above it (too disciplined), or below it (too chaotic).
//
// Algorithm:
//   1. Read metrics/hme-musical-correlation.json history.
//   2. Rank rounds by a composite "musical outcome" score = 0.5*
//      perceptual_complexity_avg + 0.3*clap_tension + 0.2*verdict_numeric.
//   3. Take the top quartile — those are the "good rounds".
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
//   - BELOW    → inject forcefully (KB context + bias bounds + hypotheses)
//   - OPTIMAL  → normal injection
//   - ABOVE    → relaxed injection (skip non-critical warnings, flag round
//                as "emergence-licensed", allow writes into low-coverage
//                territory without coherence_violation emission)
//
// Runs as a POST_COMPOSITION step after compute-musical-correlation.js.
// Non-fatal.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MUSICAL = path.join(ROOT, 'metrics', 'hme-musical-correlation.json');
const COHERENCE = path.join(ROOT, 'metrics', 'hme-coherence.json');
const OUT = path.join(ROOT, 'metrics', 'hme-coherence-budget.json');

const MIN_HISTORY = 8;
const PRIOR_BAND = [0.55, 0.85];
const HISTORY_CAP = 60;

function loadJsonMaybe(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_e) { return null; }
}

function musicalOutcomeScore(snapshot) {
  // Composite scalar in ~[0, 1.1].
  let score = 0;
  let weights = 0;
  if (typeof snapshot.perceptual_complexity_avg === 'number') {
    score += 0.5 * snapshot.perceptual_complexity_avg;
    weights += 0.5;
  }
  if (typeof snapshot.clap_tension === 'number') {
    // CLAP similarity scores are typically 0..0.3 — rescale
    score += 0.3 * Math.min(1, snapshot.clap_tension * 3);
    weights += 0.3;
  }
  if (typeof snapshot.verdict_numeric === 'number') {
    score += 0.2 * snapshot.verdict_numeric;
    weights += 0.2;
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

function main() {
  const musical = loadJsonMaybe(MUSICAL);
  const coherence = loadJsonMaybe(COHERENCE);
  const currentCoherence =
    coherence && typeof coherence.score === 'number' ? coherence.score : null;

  const history = (musical && Array.isArray(musical.history)) ? musical.history : [];
  const scored = history
    .map((s) => ({
      ts: s.timestamp,
      coherence: s.hme_coherence,
      outcome: musicalOutcomeScore(s),
    }))
    .filter((x) => typeof x.coherence === 'number' && typeof x.outcome === 'number');

  let band;
  let bandSource;
  let bandRounds = 0;

  if (scored.length < MIN_HISTORY) {
    band = PRIOR_BAND.slice();
    bandSource = `prior (${scored.length}/${MIN_HISTORY} rounds — using default)`;
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

  // Classify current state
  let state, prescription;
  if (currentCoherence === null) {
    state = 'INSUFFICIENT_DATA';
    prescription = 'wait for at least one coherence score';
  } else if (currentCoherence < band[0]) {
    state = 'BELOW';
    prescription = (
      'TIGHTEN: coherence below optimal band. Proxy should inject forcefully — ' +
      'KB context, bias bounds, and open hypotheses for every write target.'
    );
  } else if (currentCoherence > band[1]) {
    state = 'ABOVE';
    prescription = (
      'RELAX: coherence above optimal band. System may be too disciplined — ' +
      'emergence suppressed. Proxy should skip non-critical warnings, ' +
      'flag round as emergence-licensed, allow writes into low-coverage ' +
      'territory without penalizing as incoherence.'
    );
  } else {
    state = 'OPTIMAL';
    prescription = 'NORMAL: coherence in optimal band. Continue standard injection.';
  }

  // Append to history
  const prev = loadJsonMaybe(OUT);
  const prevHistory = Array.isArray(prev && prev.history) ? prev.history : [];
  const newHistory = prevHistory.concat([{
    timestamp: new Date().toISOString(),
    coherence: currentCoherence,
    band,
    state,
  }]).slice(-HISTORY_CAP);

  const report = {
    meta: {
      script: 'compute-coherence-budget.js',
      timestamp: new Date().toISOString(),
      musical_rounds_scored: scored.length,
      band_source: bandSource,
      band_derived_from_rounds: bandRounds,
    },
    band: [Number(band[0].toFixed(4)), Number(band[1].toFixed(4))],
    current_coherence: currentCoherence,
    state,
    prescription,
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
