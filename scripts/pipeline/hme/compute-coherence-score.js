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
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');

const ACTIVITY = path.join(METRICS_DIR, 'hme-activity.jsonl');
const STALENESS = path.join(METRICS_DIR, 'kb-staleness.json');
const VIOLATIONS = path.join(METRICS_DIR, 'hme-violations.json');
const OUT = path.join(METRICS_DIR, 'hme-coherence.json');

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
  // Return the window between the two most recent PIPELINE-emitted
  // round_complete events. Pipeline rounds carry a 'verdict' field;
  // chat-turn markers (historical, pre-rename) don't -- those are excluded.
  //
  // ALWAYS use the most recent pair, even if empty. An empty window
  // correctly signals "this round had no relevant writes" rather than
  // searching backward through history for a window that did. Previous
  // behavior walked old round pairs looking for writes, which pulled in
  // prehistoric LanceDB noise when the current round was legitimately
  // quiet.
  const MAX_FALLBACK_EVENTS = 2000;
  const rcIndices = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.event !== 'round_complete') continue;
    if (!e.verdict) continue;
    rcIndices.push(i);
    if (rcIndices.length >= 2) break;  // only need the two most recent
  }
  if (rcIndices.length === 0) {
    // No real round boundaries yet -- return the recent tail rather than
    // everything-before-oldest. Keeps the score honest during ramp-up.
    return events.slice(-MAX_FALLBACK_EVENTS);
  }
  if (rcIndices.length === 1) {
    // Only one pipeline round -- use events after it (the current round in
    // progress, or the empty trailing window after the last round ended).
    return events.slice(rcIndices[0] + 1);
  }
  // The canonical case: window between the second-most-recent and most-recent
  // pipeline round_completes. That's the round that JUST finished.
  const latest = rcIndices[0];
  const prev = rcIndices[1];
  return events.slice(prev + 1, latest + 1);
}



function emitActivity(event, fields) {
  // Best-effort async event emission so compute-coherence-score can surface
  // idle_round / empty-window signals without blocking. Uses emit.py's CLI
  // surface, same as every other pipeline step.
  const { spawn } = require('child_process');
  const args = [path.join(ROOT, 'tools', 'HME', 'activity', 'emit.py'),
                '--event=' + event];
  for (const k of Object.keys(fields || {})) {
    if (fields[k] === null || fields[k] === undefined) continue;
    args.push('--' + k + '=' + String(fields[k]));
  }
  try {
    spawn('python3', args, {
      stdio: 'ignore', detached: true, cwd: ROOT,
      env: Object.assign({}, process.env, { PROJECT_ROOT: ROOT }),
    }).unref();
  } catch (_e) { /* best-effort */ }
}


function main() {
  const events = readEvents();
  const windowEvents = sliceToRound(events);
  const idx = indexByEvent(windowEvents);

  // Idle-round detection: a window with zero human/agent file_written events
  // is not a meaningful coherence measurement. Emit idle_round so downstream
  // analyzers can distinguish "no data" rounds from "0% coverage" rounds --
  // they have very different meanings.
  const rawWrites_ = idx.get('file_written') || [];
  const humanWrites_ = rawWrites_.filter((e) => e.source === 'fs_watcher').length;
  if (humanWrites_ === 0) {
    emitActivity('idle_round', {
      session: 'pipeline',
      window_events: windowEvents.length,
      file_written_total: rawWrites_.length,
      file_written_human: humanWrites_,
      reason: rawWrites_.length === 0
        ? 'no file_written events at all'
        : `all ${rawWrites_.length} writes are pipeline_script or legacy`,
    });
  }

  // Component 1: read coverage -- only POST-MIGRATION human/agent writes
  // count. Three exclusion criteria:
  //   (a) source missing entirely -> pre-migration event, no source field
  //       existed when the write was emitted. Can't judge its coherence.
  //   (b) source=pipeline_script -> pipeline-mechanical edit (fix-non-ascii,
  //       verify-boot-order --fix, formatters). Not human intent-bearing.
  //   (c) source=fs_watcher -> the real signal: a human or agent edited a
  //       file in the allow-listed source tree.
  const rawWrites = idx.get('file_written') || [];
  const writes = rawWrites.filter((e) => e.source === 'fs_watcher');
  const pipelineWrites = rawWrites.filter((e) => e.source === 'pipeline_script').length;
  const legacyWrites = rawWrites.filter((e) => !e.source).length;
  const writesWithPriorRead = writes.filter((e) => e.hme_read_prior === true).length;
  // Null readCoverage = "no measurable writes in window." The downstream
  // reason field distinguishes why: no writes at all vs all-legacy vs
  // all-pipeline.
  // Low-sample-size floor: <5 human-intent writes means the read_coverage
  // ratio swings wildly on single events. Flag as null-with-reason rather
  // than computing a statistically meaningless score that would drag the
  // musical correlation down. Set HME_COHERENCE_MIN_WRITES=1 to disable.
  const MIN_WRITES_FOR_SCORE = parseInt(process.env.HME_COHERENCE_MIN_WRITES || '5', 10);
  let readCoverage = null;
  let readCoverageNullReason = null;
  if (writes.length >= MIN_WRITES_FOR_SCORE) {
    readCoverage = writesWithPriorRead / writes.length;
  } else if (writes.length > 0) {
    readCoverageNullReason = `only ${writes.length} human-intent write(s), need >=${MIN_WRITES_FOR_SCORE} for statistically meaningful coverage`;
  } else if (rawWrites.length === 0) {
    readCoverageNullReason = "no file_written events in window";
  } else if (legacyWrites === rawWrites.length) {
    readCoverageNullReason = `all ${legacyWrites} writes lack source field (pre-migration legacy events)`;
  } else if (pipelineWrites === rawWrites.length) {
    readCoverageNullReason = `all ${pipelineWrites} writes are pipeline-mechanical (source=pipeline_script)`;
  } else {
    readCoverageNullReason = `${legacyWrites} legacy + ${pipelineWrites} pipeline writes, 0 human-intent writes`;
  }

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
  //   STALE    = KB entry exists but module has evolved past it (bad -- we're
  //              editing known-drifted code without updating KB)
  //   MISSING  = no KB entry at all (not bad -- exploratory edit into
  //              uncharted territory; rewards via productive_incoherence)
  //   FRESH    = KB up-to-date (good -- edits are well-grounded)
  //   (undef)  = module not in index (e.g. config files) -- excluded
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
    // If EVERY touch was MISSING, stalenessPenalty stays at 1.0 --
    // exploration isn't punished, and the productive_incoherence bonus
    // (computed below) is where that behavior gets rewarded.
  }

  // When read_coverage is null (no measurable human/agent writes), emit
  // score=null too rather than multiplying out a 0.5 fallback that looks
  // like a real measurement. The downstream musical-correlation will
  // skip null entries; the old fallback silently produced a synthetic
  // 0.5 signal that polluted the correlation with noise indistinguishable
  // from a real mediocre round.
  const baseScore = readCoverage !== null
    ? (readCoverage * violationPenalty * stalenessPenalty)
    : null;
  const score = baseScore !== null
    ? clamp(baseScore * explorationBonus, 0, 1)
    : null;

  // Trend: diff against previous hme-coherence.json (if there's a backup)
  // We don't have a snapshot system for this file yet -- use the existing
  // report as "previous" by loading it before we overwrite.
  const prev = loadJson(OUT);
  const prevScore = prev && typeof prev.score === 'number' ? prev.score : null;
  const delta = (prevScore === null || score === null)
    ? null
    : Number((score - prevScore).toFixed(4));

  const report = {
    meta: {
      script: 'compute-coherence-score.js',
      timestamp: new Date().toISOString(),
      window_events: windowEvents.length,
    },
    score: score !== null ? Number(score.toFixed(4)) : null,
    previous_score: prevScore,
    delta,
    components: {
      read_coverage: readCoverage !== null ? Number(readCoverage.toFixed(4)) : null,
      read_coverage_null_reason: readCoverageNullReason,
      read_coverage_detail: {
        writes_with_prior_read: writesWithPriorRead,
        total_writes: writes.length,
        pipeline_writes_excluded: pipelineWrites,
        legacy_writes_excluded: legacyWrites,
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
        // Distinguishes "no writes to evaluate" (staleness is vacuously
        // clean) from "writes existed but none matched the index" (real
        // coverage gap). Without this field, staleness_penalty=1.0 looked
        // identical in both cases.
        evaluation_reason: writes.length === 0
          ? 'no_writes_to_evaluate'
          : (touchesWithIndexInfo === 0
              ? 'writes_exist_but_none_match_staleness_index'
              : 'evaluated'),
      },
      exploration_bonus: Number(explorationBonus.toFixed(4)),
      exploration_detail: {
        productive_incoherence_count: productiveCount,
        bonus_cap: 1.2,
      },
      base_score: baseScore !== null ? Number(baseScore.toFixed(4)) : null,
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  const pct = report.score !== null ? (report.score * 100).toFixed(1) : 'null';
  const deltaStr = delta === null ? '' : delta >= 0 ? ` (+${(delta * 100).toFixed(1)})` : ` (${(delta * 100).toFixed(1)})`;
  const readPct = readCoverage !== null ? `${(readCoverage * 100).toFixed(0)}%` : 'null';
  console.log(
    `compute-coherence-score: ${pct}/100${deltaStr}  ` +
      `[read=${readPct} ` +
      `lazy=${lazyViolationCount} ` +
      `stale_pen=${(stalenessPenalty * 100).toFixed(0)}% ` +
      `expl_bonus=${((explorationBonus - 1) * 100).toFixed(0)}% (${productiveCount} productive)]` +
      (readCoverageNullReason ? `  [${readCoverageNullReason}]` : ''),
  );
}

main();
