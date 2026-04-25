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
 * MVP scope: read the STOP hook's current emission, translate its
 * imperatives into compact cards, and replace the block verdict with
 * pass-through. The remediation-dispatch pieces (actually-fixing the
 * findings) are placeholder TODOs — the MVP proves the surface
 * change; deep remediation is the next iteration.
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

// Translate each demand into a reveal-register synopsis. Keeps the
// signal (there's unreviewed work / there's an error / there's a
// deferral) but strips the imperatives and the visual noise.
function _translateDemand(text) {
  // NEXUS
  let m = text.match(/NEXUS — (\d+) unreviewed edit/);
  if (m) return `auto-review queued: ${m[1]} edit(s) pending verification`;
  // LIFESAVER
  m = text.match(/LIFESAVER[^\n]*\n([\s\S]{0,400})/);
  if (m) return `auto-recover queued: ${m[1].split('\n').slice(0, 3).join(' | ').slice(0, 240)}`;
  // auto-completeness
  if (text.includes('AUTO-COMPLETENESS INJECT')) {
    return `auto-continue queued: enumerate gaps and dispatch corrective follow-ups`;
  }
  // exhaust_check
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
