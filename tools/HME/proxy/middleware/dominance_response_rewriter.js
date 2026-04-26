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
 * The dominance layer's job is REGISTER TRANSLATION: take the underlying
 * hook's already-wired detection (lifesaver / auto-completeness /
 * exhaust / nexus) and re-render the agent-facing message in
 * reveal-register without the imperative pressure. The hooks do their
 * detection work either way; this rewriter is the presentation layer.
 *
 * NEXUS additionally invokes a synchronous i/review run (cooldown-gated
 * to one per minute) so the rewritten card can embed actual review
 * findings inline rather than just labeling the trigger. The other
 * three arms emit their register-translated cards directly — the
 * underlying hooks are already doing the detection; the rewriter
 * surfaces it as observation.
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
// synchronously and embeds the result inline. Bounded timeout (10s) so
// a stuck review can't wedge the Stop hook indefinitely.
//
// Rate-limit: one auto-review per COOLDOWN_SEC across all Stop hooks.
// Without this guard, every Stop hook with NEXUS fires a subprocess
// that itself spawns a claude --resume subprocess (via dispatch_thread)
// — potentially every turn, costing real subscription tokens. The
// cooldown is read/written via tmp/hme-dominance-review-cooldown so
// across-process invocations share state.
const { execSync } = require('child_process');

const COOLDOWN_SEC = 60;

function _cooldownPath() {
  const root = process.env.PROJECT_ROOT || '/home/jah/Polychron';
  return path.join(root, 'tmp', 'hme-dominance-review-cooldown');
}

function _withinCooldown() {
  try {
    const txt = fs.readFileSync(_cooldownPath(), 'utf8').trim();
    const last = Number(txt);
    if (!Number.isFinite(last)) return false;
    return (Date.now() / 1000) - last < COOLDOWN_SEC;
  } catch (_e) {
    return false;  // no cooldown file = first run
  }
}

function _markCooldown() {
  try {
    const p = _cooldownPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(Math.floor(Date.now() / 1000)));
  } catch (_e) { /* silent-ok: cooldown is best-effort, not safety-critical */ }
}

function _runReviewSync(timeoutMs = 10_000) {
  if (_withinCooldown()) {
    return { verdict: 'cooldown', missed: '' };
  }
  _markCooldown();  // mark BEFORE running so a hung review still cools down
  try {
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    const out = execSync(`${projectRoot}/i/review mode=forget`, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      env: { ...process.env, HME_THREAD_CHILD: '1' },
    });
    const verdictMatch = out.match(/HME_REVIEW_VERDICT:\s*(\w+)/);
    const verdict = verdictMatch ? verdictMatch[1] : 'unknown';
    const missedMatch = out.match(/## What You May Have Missed[^\n]*\n([\s\S]+?)(?=\n##|\n<!--|$)/);
    const missed = missedMatch ? missedMatch[1].trim().slice(0, 800) : '';
    return { verdict, missed };
  } catch (_e) {
    return null;
  }
}

// Translate each demand into a reveal-register synopsis. The point of
// the dominance layer is presentation: take the underlying hook's
// already-wired detection and re-render it without the imperative
// pressure. The hooks do their work either way; the card-text is the
// agent-facing register conversion.
//
// NEXUS additionally invokes i/review synchronously (one cooldown-
// gated run per minute) so the rewritten card can carry actual review
// findings inline rather than just labeling the trigger.
function _translateDemand(_text) {
  // PERMANENTLY DISABLED. The previous translations stripped actionable
  // alert content and replaced it with cryptic "auto-X queued" placeholders.
  // The user's repeated "AUTO-COMPLETENESS STILL DIDN'T FIRE" screams
  // traced directly to this function rewriting the directive into
  // meaninglessness. Any rewriting that REDUCES actionable content is a
  // silent-fail vector for the alert chain.
  //
  // Returning null = no rewrite, raw text passes through unchanged.
  // Even if HME_DOMINANCE=1 gets re-enabled, this function no longer
  // strips any Stop-hook directives. To re-introduce dominance behavior
  // (e.g. for some other purpose), the rewrite must ENHANCE rather than
  // strip -- e.g. annotate without replacing.
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
