// scripts/pipeline/compute-musical-correlation.js
//
// Phase 4.1 of openshell_features_to_mimic.md -- the external anchor.
//
// Every HME metric so far (coherence score, prediction accuracy, staleness,
// drift, crystallization confidence) is internally circular. A perfectly
// coherent HME that produces musically incoherent compositions has
// optimized the wrong thing entirely. This script correlates HME's own
// per-round self-assessment with the actual musical output the pipeline
// produced and treats that correlation as the ground-truth validator for
// everything HME does.
//
// Data sources (all already present post-pipeline):
//   metrics/hme-coherence.json              round coherence score (Phase 2.3)
//   metrics/hme-prediction-accuracy.json    EMA + per-round history (Phase 3.4)
//   metrics/fingerprint-comparison.json     STABLE/EVOLVED/DRIFTED verdict
//   metrics/perceptual-report.json          EnCodec entropy + CLAP similarity
//
// Output: metrics/hme-musical-correlation.json containing a per-round
// snapshot plus rolling-window Pearson correlations between each HME
// self-assessment signal and each musical-reality signal. If the
// correlations drop below a threshold (default 0.2), we emit a LIFESAVER
// warning because it means HME's self-model has structurally decoupled
// from musical outcomes.
//
// Non-fatal. Runs post-composition after both compute-coherence-score.js
// and reconcile-predictions.js have written their files.

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJson, loadJsonl, clamp } = require('./utils');

const COHERENCE    = path.join(METRICS_DIR, 'hme-coherence.json');
const ACCURACY     = path.join(METRICS_DIR, 'hme-prediction-accuracy.json');
const FINGERPRINT  = path.join(METRICS_DIR, 'fingerprint-comparison.json');
const PERCEPTUAL   = path.join(METRICS_DIR, 'perceptual-report.json');
const OUT          = path.join(METRICS_DIR, 'hme-musical-correlation.json');

const ROLLING_WINDOW = 20;
const HISTORY_CAP = 60;
const WARN_THRESHOLD = parseFloat(process.env.HME_MUSICAL_WARN_THRESHOLD || '0.2');


// R32: math extracted to correlation_math.js helper module.
const { extractPerceptualSignals, pearson } = require('./correlation_math');

function main() {
  const coherence   = loadJson(COHERENCE);
  const accuracy    = loadJson(ACCURACY);
  const fingerprint = loadJson(FINGERPRINT);
  const perceptual  = loadJson(PERCEPTUAL);
  const prev        = loadJson(OUT);
  const traceSummary = loadJson(path.join(METRICS_DIR, 'trace-summary.json'));
  const _axisAdj = (axis) => {
    const v = traceSummary && traceSummary.axisEnergyEquilibrator
      && traceSummary.axisEnergyEquilibrator.perAxisAdj
      && traceSummary.axisEnergyEquilibrator.perAxisAdj[axis];
    return typeof v === 'number' ? v : null;
  };

  const hmeCoherence = coherence && typeof coherence.score === 'number' ? coherence.score : null;
  const hmeAccuracy  = accuracy && typeof accuracy.ema === 'number' ? accuracy.ema : null;
  const verdict      = (fingerprint && (fingerprint.verdict || fingerprint.result)) || null;
  const percSignals  = extractPerceptualSignals(perceptual) || {};

  // HCI delta: round-over-round change in the HCI score. Non-null after the
  // first round. Has real variance (unlike verdict_numeric which is always 1
  // for STABLE runs), enabling meaningful correlation with coherence metrics.
  const prevHistory = Array.isArray(prev && prev.history) ? prev.history : [];
  const prevHci = prevHistory.length > 0
    ? (prevHistory[prevHistory.length - 1].hci ?? null) : null;
  // Read current HCI from pipeline-summary.json (written before this script runs)
  let currentHci = null;
  try {
    const summary = loadJson(path.join(METRICS_DIR, 'pipeline-summary.json'));
    if (summary && typeof summary.hci === 'number') currentHci = summary.hci;
  } catch (_e) { /* optional */ }
  const hciDelta = (currentHci !== null && prevHci !== null) ? currentHci - prevHci : null;

  // HCI regression detection: two consecutive rounds with hci_delta < -2 emits
  // an activity event. The 2-point threshold is intentionally loose -- a single
  // noisy round shouldn't alert, but sustained decline should.
  const REGRESSION_THRESHOLD = -2;
  if (hciDelta !== null && hciDelta < REGRESSION_THRESHOLD) {
    const prevDelta = prevHistory.length > 0
      ? (prevHistory[prevHistory.length - 1].hci_delta ?? null) : null;
    if (prevDelta !== null && prevDelta < REGRESSION_THRESHOLD) {
      const { spawn } = require('child_process');
      try {
        spawn('python3', [
          path.join(ROOT, 'tools', 'HME', 'activity', 'emit.py'),
          '--event=hci_regression',
          `--current_hci=${currentHci}`,
          `--prev_hci=${prevHci}`,
          `--delta_cur=${hciDelta.toFixed(2)}`,
          `--delta_prev=${prevDelta.toFixed(2)}`,
          '--session=pipeline',
        ], { stdio: 'ignore', detached: true, cwd: ROOT,
             env: Object.assign({}, process.env, { PROJECT_ROOT: ROOT }) }).unref();
      } catch (_e) { /* best-effort */ }
      // Persist structured alert so i/status can surface it -- the activity
      // event alone isn't guaranteed to be read before the next user turn.
      try {
        fs.writeFileSync(
          path.join(METRICS_DIR, 'hci-regression-alert.json'),
          JSON.stringify({
            ts: new Date().toISOString(),
            current_hci: currentHci,
            prev_hci: prevHci,
            delta_cur: Number(hciDelta.toFixed(2)),
            delta_prev: Number(prevDelta.toFixed(2)),
            action: 'Run `i/review mode=forget` to investigate. '
                  + 'Inspect metrics/hci-verifier-snapshot.json vs .prev for which verifiers regressed.',
          }, null, 2) + '\n',
        );
      } catch (_we) { /* best-effort */ }
    }
  } else {
    // No regression this round -- clear any stale alert file.
    const alertPath = path.join(METRICS_DIR, 'hci-regression-alert.json');
    try { if (fs.existsSync(alertPath)) fs.unlinkSync(alertPath); }
    catch (_ue) { /* best-effort */ }
  }

  // Verdict -> numeric: STABLE=1, EVOLVED=1.1, DRIFTED=0, other=0.5
  const verdictMap = { STABLE: 1, EVOLVED: 1.1, DRIFTED: 0, UNKNOWN: 0.5 };
  const verdictNumeric = verdict ? (verdictMap[verdict] ?? 0.5) : null;

  // Round identity: git HEAD short-hash + sequence-for-this-sha. Two pipeline
  // runs from the same commit produce r_abc_1 and r_abc_2, making "did my
  // change improve metric Y" answerable -- without the sequence, two runs
  // of the same code got different timestamped IDs, turning identity into
  // timing noise. The sequence comes from counting prior history entries
  // whose round_id starts with r_<sha>_.
  let roundId = null;
  let currentSha = null;
  let currentTreeHash = null;
  try {
    const { execSync } = require('child_process');
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: require('path').dirname(OUT) + '/..', stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (sha) {
      currentSha = sha;
      // Tree hash: two runs from the same working tree (even different commits)
      // produce identical tree hashes. Better for same-commit determinism check
      // since auto-commits change the SHA but not the tree if files didn't change.
      try {
        currentTreeHash = execSync('git rev-parse HEAD^{tree}', {
          cwd: require('path').dirname(OUT) + '/..', stdio: ['ignore', 'pipe', 'ignore'],
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');
        }).toString().trim().slice(0, 12);
      } catch (_te) { /* tree hash optional */ }
      const priorCount = Array.isArray(prev && prev.history)
        ? prev.history.filter((h) => h && typeof h.round_id === 'string' &&
                                      h.round_id.startsWith(`r_${sha}_`)).length
        : 0;
      roundId = `r_${sha}_${priorCount + 1}`;
    }
  } catch (_err) { /* git not available -- fall through to timestamp-only */ }
  if (!roundId) roundId = `r_ts_${Math.floor(Date.now() / 1000)}`;

  const snapshot = {
    round_id: roundId,
    sha: currentSha,
    tree_hash: currentTreeHash,
    timestamp: new Date().toISOString(),
    hme_coherence: hmeCoherence,
    hme_prediction_accuracy: hmeAccuracy,
    fingerprint_verdict: verdict,
    verdict_numeric: verdictNumeric,
    perceptual_complexity_avg: percSignals.complexity_avg,
    clap_tension: percSignals.clap_tension,
    encodec_entropy_avg: percSignals.encodec_entropy_avg,
    hci: currentHci,
    hci_delta: hciDelta,
    // R16 #6: hci_normalized as verdict_numeric_v2. verdict_numeric collapses
    // to 1.0 for all STABLE runs, making correlation degenerate. hci has real
    // variance (94.7->95.1->96.4->96.5 across recent rounds) -- normalize to 0..1
    // for the same role: "how well is composition doing" anchor.
    hci_normalized: typeof currentHci === 'number' ? currentHci / 100 : null,
    // R16 #3: drifted_dimension_count. STABLE=0, EVOLVED=1-2, DRIFTED=3+.
    // Even in all-STABLE sessions, dimension-level drift counts carry trend signal.
    drifted_dimension_count: (fingerprint && typeof fingerprint.driftedDimensions === 'number')
      ? fingerprint.driftedDimensions : null,
    // Per-axis adjustment totals: enables correlating "how much does each axis
    // need re-balancing" against "does HME self-assess well" and "is the music
    // actually good." High trust_adj_count correlated with low verdict_numeric
    // would mean the trust floor is firing most when music degrades.
    trust_adj_count: _axisAdj('trust'),
    tension_adj_count: _axisAdj('tension'),
    entropy_adj_count: _axisAdj('entropy'),
  };

  // Append to history
  const history = Array.isArray(prev && prev.history) ? prev.history.slice() : [];
  history.push(snapshot);
  const trimmed = history.slice(-HISTORY_CAP);

  // Compute rolling-window correlations over the last ROLLING_WINDOW rounds
  const window = trimmed.slice(-ROLLING_WINDOW);
  const xs = {
    coherence: window.map((s) => s.hme_coherence).filter((x) => typeof x === 'number'),
    accuracy: window.map((s) => s.hme_prediction_accuracy).filter((x) => typeof x === 'number'),
  };
  const ys = {
    verdict: window.map((s) => s.verdict_numeric).filter((x) => typeof x === 'number'),
    complexity: window.map((s) => s.perceptual_complexity_avg).filter((x) => typeof x === 'number'),
    clap: window.map((s) => s.clap_tension).filter((x) => typeof x === 'number'),
  };

  // For correlation we need aligned pairs
  function aligned(xKey, yKey) {
    const pairs = [];
    for (const s of window) {
      const xv = s[xKey];
      const yv = s[yKey];
      if (typeof xv === 'number' && typeof yv === 'number') {
        pairs.push([xv, yv]);
      }
    }
    return {
      xs: pairs.map((p) => p[0]),
      ys: pairs.map((p) => p[1]),
      n: pairs.length,
    };
  }

  const correlations = {};
  const targets = [
    ['hme_coherence', 'verdict_numeric'],
    ['hme_coherence', 'perceptual_complexity_avg'],
    ['hme_coherence', 'clap_tension'],
    ['hme_coherence', 'hci_delta'],
    // R16: hci_normalized as the outcome anchor (verdict_numeric is constant).
    ['hme_coherence', 'hci_normalized'],
    ['hme_coherence', 'drifted_dimension_count'],
    ['hme_prediction_accuracy', 'verdict_numeric'],
    ['hme_prediction_accuracy', 'perceptual_complexity_avg'],
    ['hme_prediction_accuracy', 'clap_tension'],
    // Per-axis adjustment counts vs outcome: reveal whether high adjustment
    // volume correlates with better or worse music (negative = overrides fire
    // most when composition struggles = system is reactive as designed).
    ['trust_adj_count', 'verdict_numeric'],
    ['tension_adj_count', 'verdict_numeric'],
    ['trust_adj_count', 'hci_delta'],
    ['tension_adj_count', 'hci_delta'],
  ];
  for (const [xk, yk] of targets) {
    const { xs: xv, ys: yv, n } = aligned(xk, yk);
    const pr = pearson(xv, yv);
    correlations[`${xk}__${yk}`] = {
      r: pr.r,
      n,
      degenerate: !!pr.degenerate,
      ...(pr.reason ? { reason: pr.reason } : {}),
    };
  }

  // Aggregate: is HME coherence meaningfully tracking something external?
  // Exclude degenerate correlations -- they're artifacts, not signal.
  const validCorrelations = Object.values(correlations)
    .filter((c) => typeof c.r === 'number' && !c.degenerate)
    .map((c) => c.r);
  const strongestCorrelation = validCorrelations.length
    ? validCorrelations.reduce((a, b) => (Math.abs(a) > Math.abs(b) ? a : b))
    : null;

  let warning = null;
  if (
    window.length >= 5 &&
    strongestCorrelation !== null &&
    Math.abs(strongestCorrelation) < WARN_THRESHOLD
  ) {
    warning = (
      `FATAL: HME self-assessment has decoupled from musical outcomes. ` +
      `Strongest correlation over ${window.length} rounds is ${strongestCorrelation.toFixed(2)} ` +
      `(threshold ${WARN_THRESHOLD}). HME is optimizing its own metrics without ` +
      `that optimization translating to musical coherence. Audit the coherence ` +
      `score formula and prediction-accuracy definition.`
    );
  }

  const report = {
    meta: {
      script: 'compute-musical-correlation.js',
      timestamp: new Date().toISOString(),
      history_length: trimmed.length,
      rolling_window: ROLLING_WINDOW,
      warn_threshold: WARN_THRESHOLD,
    },
    latest: snapshot,
    correlations,
    strongest_correlation: strongestCorrelation,
    warning,
    history: trimmed,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  const bits = [];
  bits.push(`coh=${hmeCoherence !== null ? (hmeCoherence * 100).toFixed(0) + '%' : 'n/a'}`);
  bits.push(`acc=${hmeAccuracy !== null ? (hmeAccuracy * 100).toFixed(0) + '%' : 'n/a'}`);
  bits.push(`verdict=${verdict || '?'}`);
  bits.push(
    `perc_tension=${percSignals.complexity_avg !== null && percSignals.complexity_avg !== undefined ? percSignals.complexity_avg.toFixed(2) : 'n/a'}`,
  );
  bits.push(
    `strongest_r=${strongestCorrelation !== null ? strongestCorrelation.toFixed(2) : 'n/a'}`,
  );
  // #8 Progress metric: samples accumulated toward min_n activation of the
  // coherence-tracks-musical-outcome invariant (needs min_n=10). Prints
  // "progress=n/10" so watchers can see how close activation is.
  const activationKey = 'hme_coherence__verdict_numeric';
  const activationN = correlations[activationKey] ? correlations[activationKey].n : 0;
  bits.push(`activation=${activationN}/10`);
  console.log(`compute-musical-correlation: ${bits.join('  ')}`);
  if (warning) {
    console.warn(warning);
  }
}

main();
