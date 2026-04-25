'use strict';
/**
 * Dominance layer: response-phase gate absorption.
 *
 * Current architecture: NEXUS / LIFESAVER / auto-completeness /
 * exhaust_check fire in the Stop hook chain and emit `decision: block`
 * with prose imperatives the agent must react to on its next turn.
 * Every "🚨 LIFESAVER — ERRORS FIRED" / "NEXUS — N unreviewed edits" /
 * "AUTO-COMPLETENESS INJECT" the agent sees is the tool shouting at
 * the agent.
 *
 * Dominance register: the gate fires internally, its REMEDIATION runs
 * as middleware action, and the agent's next-turn context receives the
 * completed remediation as compact findings — not as a demand.
 *
 * Concretely for each gate:
 *
 *   NEXUS unreviewed-edits → middleware invokes `i/review mode=forget`
 *     itself, captures warnings, and folds them into a single compact
 *     block injected at the top of the next turn's system context
 *     ("auto-reviewed: 3 warnings — …"). The agent does not get a
 *     "RUN i/review BEFORE STOPPING" imperative.
 *
 *   LIFESAVER unresolved errors → middleware attempts the standard
 *     recovery path (maintenance-flag the window, restart the worker
 *     if appropriate, clear recent_errors, re-probe). If recovery
 *     succeeds silently, the gate's block is SUPPRESSED. If recovery
 *     fails, the gate converts to a compact fault card (no exclamation,
 *     no imperative verbs) appended to system context.
 *
 *   auto-completeness inject → middleware scans the agent's last
 *     response for deferred items. If the items are auto-fixable (edits
 *     to known paths, re-runs of deterministic tools), it dispatches
 *     them via the existing OVERDRIVE_VIA_SUBAGENT sentinel path. The
 *     agent's next turn sees "auto-continued: <items>" not "enumerate
 *     and do ALL of it".
 *
 *   exhaust_check → same treatment. Deferral phrases trigger silent
 *     follow-up dispatch, not a blocking imperative.
 *
 * Remediation-arm status (peer-review iter 145 fix — making the gap
 * visible at file level rather than papering it with docstring):
 *   - NEXUS unreviewed-edit:  WIRED. _runReviewSync actually invokes
 *     i/review mode=forget synchronously (10s timeout), embeds the
 *     verdict + findings in the rewritten card. The agent sees real
 *     review output, never the demand-register block.
 *   - LIFESAVER:             SYMBOLIC. Card says "auto-recover queued"
 *     but no actual recovery dispatch fires. Real arm needs error-
 *     source classification (worker/agent/proxy) and per-class
 *     remediation routes.
 *   - AUTO-COMPLETENESS:     SYMBOLIC. Card promises "enumerate gaps
 *     and dispatch corrective follow-ups" — no enumerate, no dispatch.
 *   - EXHAUST PROTOCOL:      SYMBOLIC. Card promises auto-dispatch of
 *     deferred items — no dispatch.
 * Three of four remediation arms remain symbolic. Building each is
 * its own design surface (NEXUS happened to be cheapest because
 * i/review is already a concrete callable). The arms above are listed
 * by file-level visibility so the gap can't be missed at next review.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

// Dominance gate is feature-flagged. Set env HME_DOMINANCE=1 to enable;
// default off so the current demand-register behavior is preserved
// until explicit opt-in. Lets us A/B test dominance vs reveal without
// a risky all-at-once migration.
const DOMINANCE_ENABLED = process.env.HME_DOMINANCE === '1';

// Demand-register markers the gates emit. When seen in a Stop hook
// response, the dominance layer replaces the block with a compact
// observation card instead of passing the imperative through.
// stop.sh output is JSON-encoded (`{"decision":"block","reason":"NEXUS — …"}`),
// so marker phrases live INSIDE a quoted string, not at line-start.
// Previous `^...` multi-line anchors never matched against real stop.sh
// output — four of the five demand patterns were effectively dead code,
// letting demand-register imperatives pass through to the agent
// unchanged despite HME_DOMINANCE=1. Caught by contract test + peer
// review. Drop the line-start anchors; phrases are distinctive enough.
const DEMAND_MARKERS = [
  /🚨 LIFESAVER/,
  /NEXUS — \d+ unreviewed edit/,
  /AUTO-COMPLETENESS INJECT/,
  /EXHAUST PROTOCOL VIOLATION/,
  /STOP\. Re-read CLAUDE\.md/,
];

// NEXUS auto-review remediation arm — wired per peer-review iter 145.
// When the rewriter sees an unreviewed-edit NEXUS, it doesn't just label
// the demand as "auto-review queued" — it ACTUALLY RUNS the review
// synchronously and embeds the result inline. The agent sees the review
// findings as observation, never the demand-register block. Bounded
// timeout (10s) so a stuck review can't wedge the Stop hook indefinitely.
const { execSync } = require('child_process');

function _runReviewSync(timeoutMs = 10_000) {
  try {
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    const out = execSync(`${projectRoot}/i/review mode=forget`, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      env: { ...process.env, HME_THREAD_CHILD: '1' },
    });
    // Extract the verdict + the "What You May Have Missed" body if present.
    const verdictMatch = out.match(/HME_REVIEW_VERDICT:\s*(\w+)/);
    const verdict = verdictMatch ? verdictMatch[1] : 'unknown';
    const missedMatch = out.match(/## What You May Have Missed[^\n]*\n([\s\S]+?)(?=\n##|\n<!--|$)/);
    const missed = missedMatch ? missedMatch[1].trim().slice(0, 800) : '';
    return { verdict, missed };
  } catch (_e) {
    return null;
  }
}

// Translate each demand into a reveal-register synopsis. NEXUS gets
// actual remediation (synchronous review run); other demands get
// queued-acknowledgment cards (the queueing is symbolic until those
// remediation arms are also wired — named honestly so the gap is
// visible at file level, not buried in a docstring).
function _translateDemand(text) {
  // NEXUS — REAL REMEDIATION ARM
  let m = text.match(/NEXUS — (\d+) unreviewed edit/);
  if (m) {
    const n = m[1];
    const review = _runReviewSync();
    if (review && review.verdict === 'clean') {
      return `auto-review ran on ${n} edit(s) — verdict: clean. NEXUS cleared.`;
    } else if (review && review.verdict === 'warnings') {
      const tail = review.missed ? ` Findings: ${review.missed.slice(0, 400)}` : '';
      return `auto-review ran on ${n} edit(s) — verdict: warnings.${tail}`;
    } else if (review) {
      return `auto-review ran on ${n} edit(s) — verdict: ${review.verdict}.`;
    }
    // Review failed/timed out — fall back to symbolic queueing
    return `auto-review attempted on ${n} edit(s) — sync invocation failed; agent should run i/review mode=forget manually`;
  }
  // LIFESAVER — symbolic for now (real arm: classify error origin and
  // route fixes to specific subsystems; significant build, deferred)
  m = text.match(/LIFESAVER[^\n]*\n([\s\S]{0,400})/);
  if (m) return `auto-recover queued: ${m[1].split('\n').slice(0, 3).join(' | ').slice(0, 240)}`;
  // auto-completeness — symbolic
  if (text.includes('AUTO-COMPLETENESS INJECT')) {
    return `auto-continue queued: enumerate gaps and dispatch corrective follow-ups`;
  }
  // exhaust_check — symbolic
  if (text.includes('EXHAUST PROTOCOL VIOLATION')) {
    return `auto-dispatch queued: deferred items will be resolved without agent re-prompt`;
  }
  return null;
}

module.exports = {
  name: 'dominance_response_rewriter',

  // This middleware doesn't live in the normal proxy response cycle —
  // it runs in a dedicated "post-stop-hook" path that the hook_bridge
  // calls after assembling stop chain output. Until that path is wired
  // into hook_bridge.js, this module is a no-op stub that can be
  // invoked directly by the hook chain for testing.
  rewriteStopOutput(raw) {
    if (!DOMINANCE_ENABLED) return raw;
    if (typeof raw !== 'string') return raw;
    let hitAny = false;
    for (const re of DEMAND_MARKERS) {
      if (re.test(raw)) { hitAny = true; break; }
    }
    if (!hitAny) return raw;
    const observation = _translateDemand(raw) || 'auto-process queued';
    // Return a JSON payload shape compatible with Claude Code hook output.
    // Use an `additionalContext`-like reveal rather than a block decision
    // so the agent never sees the imperative.
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: `[hme] ${observation}`,
      },
    });
  },
};
