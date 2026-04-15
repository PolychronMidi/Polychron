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
// the score up to +20% — rewarding the Evolver for pushing into genuinely
// novel ground rather than converging to a local optimum.
//
// Output: metrics/hme-coherence.json with the score, components, and trend
// delta against the previous round (if metrics/snapshots/ has one).
//
// Runs as a POST_COMPOSITION step so the staleness index is already built.
// Non-fatal — produces a diagnostic, doesn't gate the pipeline (that's
// check-hme-coherence.js's job in PRE_COMPOSITION).

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
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

function sliceToRound(events) {
  let lastRound = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i] && events[i].event === 'round_complete') {
      lastRound = i;
      break;
    }
  }
  return lastRound >= 0 ? events.slice(lastRound + 1) : events;
}

function loadJsonMaybe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function main() {
  const events = readEvents();
  const windowEvents = sliceToRound(events);

  // Component 1: read coverage
  const writes = windowEvents.filter((e) => e && e.event === 'file_written');
  const writesWithPriorRead = writes.filter((e) => e.hme_read_prior === true).length;
  const readCoverage = writes.length > 0 ? writesWithPriorRead / writes.length : 1;

  // Component 2: violation penalty (lazy violations only).
  // productive_incoherence events do NOT count here — they feed the
  // exploration bonus below.
  const hookViolations = windowEvents.filter((e) => e && e.event === 'coherence_violation');
  const violationsFromFile = loadJsonMaybe(VIOLATIONS);
  const lazyViolationCount = hookViolations.length +
    (violationsFromFile && Array.isArray(violationsFromFile.violations)
      ? violationsFromFile.violations.length
      : 0);
  const violationPenalty = clamp(1 - lazyViolationCount * 0.1, 0, 1);

  // Phase 3.2: exploration bonus for productive incoherence events
  const productiveEvents = windowEvents.filter(
    (e) => e && e.event === 'productive_incoherence',
  );
  const productiveCount = productiveEvents.length;
  const explorationBonus = 1 + Math.min(0.2, productiveCount * 0.05);

  // Component 3: staleness penalty — ratio of write events that touched a
  // STALE or MISSING module. Uses the index built in the previous step.
  const stalenessIdx = loadJsonMaybe(STALENESS);
  let stalenessPenalty = 1;
  let touchesOnStale = 0;
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
      if (status === 'STALE' || status === 'MISSING') {
        touchesOnStale++;
      }
    }
    if (touchesWithIndexInfo > 0) {
      stalenessPenalty = 1 - touchesOnStale / touchesWithIndexInfo;
    }
  }

  const baseScore = readCoverage * violationPenalty * stalenessPenalty;
  const score = clamp(baseScore * explorationBonus, 0, 1);

  // Trend: diff against previous hme-coherence.json (if there's a backup)
  // We don't have a snapshot system for this file yet — use the existing
  // report as "previous" by loading it before we overwrite.
  const prev = loadJsonMaybe(OUT);
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
      read_coverage: Number(readCoverage.toFixed(4)),
      read_coverage_detail: {
        writes_with_prior_read: writesWithPriorRead,
        total_writes: writes.length,
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
        touches_on_stale_or_missing: touchesOnStale,
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
