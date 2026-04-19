// scripts/pipeline/compute-coherence-score.js
//
// Phase-2.3 of openshell_features_to_mimic.md. Produces a single scalar
// coherence score for the current round by cross-referencing the activity
// bridge event stream with the KB staleness index and the violations log.
//
//   coherence_score = (read_coverage * violation_penalty * staleness_penalty)
//                     * exploration_bonus
//
// Where:
//   read_coverage      = files_written_with_prior_hme_read / total_files_written
//   violation_penalty  = max(0, 1 - lazy_violation_count * 0.1)
//   staleness_penalty  = 1 - (touches_on_stale_modules / total_touches)
//   exploration_bonus  = 1 + min(0.2, productive_incoherence_count * 0.05)
//
// Phase 3.2 split: lazy `coherence_violation` events (FRESH coverage, agent
// skipped the read) count against violation_penalty. `productive_incoherence`
// events (MISSING coverage, exploratory write into uncharted territory) boost
// the score up to +20% -- rewarding the Evolver for pushing into genuinely
// novel ground rather than converging to a local optimum.
//
// Output: metrics/hme-coherence.json with the score, components, and trend
// delta against the previous round (if metrics/snapshots/ has one).
//
// Runs as a POST_COMPOSITION step so the staleness index is already built.
// Non-fatal -- produces a diagnostic, doesn't gate the pipeline (that's
// check-hme-coherence.js's job in PRE_COMPOSITION).

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJson, loadJsonl, clamp } = require('./utils');

const ACTIVITY = path.join(ROOT, 'metrics', 'hme-activity.jsonl');
const STALENESS = path.join(ROOT, 'metrics', 'kb-staleness.json');
const VIOLATIONS = path.join(ROOT, 'metrics', 'hme-violations.json');
const OUT = path.join(ROOT, 'metrics', 'hme-coherence.json');

function readEvents() {
  if (!fs.existsSync(ACTIVITY)) return [];
  const raw = fs.readFileSync(ACTIVITY, 'utf8');
  const events = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { events.push(JSON.parse(s)); } catch (_e) { /* skip corrupt */ }
  }
  return events;
}

// Build an event-type index once per run so the multiple filter() passes
// below (file_written, coherence_violation, productive_incoherence) don't
// each walk the full event list. For a 6000-event stream this converts
// four O(n) scans into one O(n) partition + three O(k) lookups.
function indexByEvent(events) {
  const idx = new Map();
  for (const e of events) {
    if (!e || typeof e.event !== 'string') continue;
    let bucket = idx.get(e.event);
    if (!bucket) { bucket = []; idx.set(e.event, bucket); }
    bucket.push(e);
  }
  return idx;
}

function sliceToRound(events) {
  // Find the two most recent round_complete events that have actual activity
  // between them. Only PIPELINE-emitted round_completes count (they carry a
  // 'verdict' field). Historical stop.sh round_completes were chat-turn
  // boundaries that flooded the log and collapsed this window to prehistoric
  // data. Those are now emitted as turn_complete; any old round_complete
  // WITHOUT a verdict field is treated as a stale turn marker and ignored.
  //
  // Also: if no pipeline-round window has writes, fall back to the last N
  // events (not everything-before-oldest), so stale history can't hide a
  // real "no writes yet" signal.
  const MAX_FALLBACK_EVENTS = 2000;
  const rcIndices = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.event !== 'round_complete') continue;
    // Pipeline rounds carry a verdict; turn-boundary rounds don't.
    // Historical events before the turn_complete rename all look like
    // turn markers -- correctly excluded.
    if (!e.verdict) continue;
    rcIndices.push(i);
  }
  if (rcIndices.length === 0) {
    // No real round boundaries yet -- return the recent tail rather than
    // the whole history. Keeps coherence score honest during the ramp-up
    // after the turn_complete/round_complete split.
    return events.slice(-MAX_FALLBACK_EVENTS);
  }
  // Try successive pairs until we find one with activity between them
  for (let p = 0; p < rcIndices.length - 1; p++) {
    const latest = rcIndices[p];
    const prev = rcIndices[p + 1];
    const window = events.slice(prev + 1, latest);
    const hasWrites = window.some((e) => e && e.event === 'file_written');
    if (hasWrites) return window;
  }
  // No pair had writes -- fall back to events after the last pipeline round.
  const lastRC = rcIndices[0];
  const tail = events.slice(lastRC + 1);
  if (tail.some((e) => e && e.event === 'file_written')) return tail;
  // No writes anywhere in the pipeline-bounded windows -- return the recent
  // tail for "no data" signalling. Never reach back into pre-split history.
  return events.slice(-MAX_FALLBACK_EVENTS);
}



function main() {
  const events = readEvents();
  const windowEvents = sliceToRound(events);
  const idx = indexByEvent(windowEvents);

  // Component 1: read coverage — only human/agent writes count. Pipeline-
  // mechanical writes (fix-non-ascii, verify-boot-order --fix, formatters)
  // are not "human intent-bearing edits" and shouldn't dilute the
  // coherence-of-editing signal. Tagged via source=pipeline_script by the
  // fs watcher when tmp/run.lock is present at write-time.
  const rawWrites = idx.get('file_written') || [];
  const writes = rawWrites.filter((e) => e.source !== 'pipeline_script');
  const pipelineWrites = rawWrites.length - writes.length;
  const writesWithPriorRead = writes.filter((e) => e.hme_read_prior === true).length;
  // 0 writes = no data, NOT perfect coherence. Use null to signal "unmeasured"
  // and fall back to the previous score if available.
  const readCoverage = writes.length > 0 ? writesWithPriorRead / writes.length : null;

  // Component 2: violation penalty (lazy violations only).
  // productive_incoherence events do NOT count here -- they feed the
  // exploration bonus below.
  const hookViolations = idx.get('coherence_violation') || [];
  const violationsFromFile = loadJson(VIOLATIONS);
  const lazyViolationCount = hookViolations.length +
    (violationsFromFile && Array.isArray(violationsFromFile.violations)
      ? violationsFromFile.violations.length
      : 0);
  const violationPenalty = clamp(1 - lazyViolationCount * 0.1, 0, 1);

  // Phase 3.2: exploration bonus for productive incoherence events
  const productiveEvents = idx.get('productive_incoherence') || [];
  const productiveCount = productiveEvents.length;
  const explorationBonus = 1 + Math.min(0.2, productiveCount * 0.05);

  // Component 3: staleness penalty -- ratio of writes to STALE modules.
  // The critical distinction:
  //   STALE    = KB entry exists but module has evolved past it (bad — we're
  //              editing known-drifted code without updating KB)
  //   MISSING  = no KB entry at all (not bad — exploratory edit into
  //              uncharted territory; rewards via productive_incoherence)
  //   FRESH    = KB up-to-date (good — edits are well-grounded)
  //   (undef)  = module not in index (e.g. config files) — excluded
  //
  // The old formula conflated STALE and MISSING as both penalizing, which
  // meant 100%-MISSING writes (shell scripts, config files, genuinely
  // new territory) collapsed the score to 0 even though that's the
  // "exploration rewarded" case. Now only STALE penalizes.
  const stalenessIdx = loadJson(STALENESS);
  let stalenessPenalty = 1;
  let touchesOnStale = 0;
  let touchesOnMissing = 0;
  let touchesOnFresh = 0;
  let touchesWithIndexInfo = 0;
  if (stalenessIdx && Array.isArray(stalenessIdx.modules)) {
    const statusByModule = new Map();
    for (const m of stalenessIdx.modules) {
      statusByModule.set(m.module, m.status);
    }
    for (const w of writes) {
      const mod = w.module;
      if (!mod) continue;
      const status = statusByModule.get(mod);
      if (status === undefined) continue;
      touchesWithIndexInfo++;
      if (status === 'STALE') {
        touchesOnStale++;
      } else if (status === 'MISSING') {
        touchesOnMissing++;
      } else if (status === 'FRESH') {
        touchesOnFresh++;
      }
    }
    // Only STALE touches (known-drifted code edited without KB refresh)
    // count against the penalty. MISSING touches are exploration.
    const penalizingTouches = touchesOnStale;
    const nonMissingTouches = touchesOnStale + touchesOnFresh;
    if (nonMissingTouches > 0) {
      stalenessPenalty = 1 - penalizingTouches / nonMissingTouches;
    }
    // If EVERY touch was MISSING, stalenessPenalty stays at 1.0 —
    // exploration isn't punished, and the productive_incoherence bonus
    // (computed below) is where that behavior gets rewarded.
  }

  const effectiveReadCoverage = readCoverage !== null ? readCoverage : 0.5; // unmeasured = 0.5 (neither good nor bad)
  const baseScore = effectiveReadCoverage * violationPenalty * stalenessPenalty;
  const score = clamp(baseScore * explorationBonus, 0, 1);

  // Trend: diff against previous hme-coherence.json (if there's a backup)
  // We don't have a snapshot system for this file yet -- use the existing
  // report as "previous" by loading it before we overwrite.
  const prev = loadJson(OUT);
  const prevScore = prev && typeof prev.score === 'number' ? prev.score : null;
  const delta = prevScore === null ? null : Number((score - prevScore).toFixed(4));

  const report = {
    meta: {
      script: 'compute-coherence-score.js',
      timestamp: new Date().toISOString(),
      window_events: windowEvents.length,
    },
    score: Number(score.toFixed(4)),
    previous_score: prevScore,
    delta,
    components: {
      read_coverage: readCoverage !== null ? Number(readCoverage.toFixed(4)) : null,
      read_coverage_detail: {
        writes_with_prior_read: writesWithPriorRead,
        total_writes: writes.length,
        pipeline_writes_excluded: pipelineWrites,
      },
      violation_penalty: Number(violationPenalty.toFixed(4)),
      violation_detail: {
        count: lazyViolationCount,
        from_activity_stream: hookViolations.length,
        from_violations_file: violationsFromFile && Array.isArray(violationsFromFile.violations)
          ? violationsFromFile.violations.length : 0,
      },
      staleness_penalty: Number(stalenessPenalty.toFixed(4)),
      staleness_detail: {
        touches_on_stale: touchesOnStale,
        touches_on_missing: touchesOnMissing,
        touches_on_fresh: touchesOnFresh,
        touches_with_index_info: touchesWithIndexInfo,
      },
      exploration_bonus: Number(explorationBonus.toFixed(4)),
      exploration_detail: {
        productive_incoherence_count: productiveCount,
        bonus_cap: 1.2,
      },
      base_score: Number(baseScore.toFixed(4)),
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  const pct = (report.score * 100).toFixed(1);
  const deltaStr = delta === null ? '' : delta >= 0 ? ` (+${(delta * 100).toFixed(1)})` : ` (${(delta * 100).toFixed(1)})`;
  console.log(
    `compute-coherence-score: ${pct}/100${deltaStr}  ` +
      `[read=${(readCoverage * 100).toFixed(0)}% ` +
      `lazy=${lazyViolationCount} ` +
      `stale_pen=${(stalenessPenalty * 100).toFixed(0)}% ` +
      `expl_bonus=${((explorationBonus - 1) * 100).toFixed(0)}% (${productiveCount} productive)]`,
  );
}

main();
