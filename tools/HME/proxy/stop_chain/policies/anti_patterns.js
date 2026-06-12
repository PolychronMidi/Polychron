'use strict';
/**
 * Pure-JS port of anti_patterns.sh -- anti-pattern blockers driven by the
 * verdict file written by the detectors policy. Each verdict maps to a
 * potential `deny` whose reason follows the hme_dominance doctrine: the tool
 * acts (the deny holds the gate) and the agent reads the consequence, not an
 * imperative demand. Every reason keeps its identifier prefix + rescue paths.
 *
 * MUST RUN AFTER: detectors
 * MUST RUN BEFORE: work_checks
 * COORDINATES WITH: work_checks
 *
 * Reads detector verdicts (must run after detectors) and fires denies
 * before work_checks so first-deny-wins surfaces the most actionable
 * signal first.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../../shared');

const VERDICTS_FILE = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'stop-detector-verdicts.env');

function readVerdicts() {
  const verdicts = {
    POLL_COUNT: '0',
    IDLE_AFTER_BG: 'ok',
    PSYCHO_STOP: 'ok',
    ACK_SKIP: 'ok',
    ABANDON_CHECK: 'ok',
    FABRICATION_CHECK: 'ok',
    EARLY_STOP: 'ok',
  };
  if (!fs.existsSync(VERDICTS_FILE)) return verdicts;
  let text = '';
  try { text = fs.readFileSync(VERDICTS_FILE, 'utf8'); }
  catch (_e) { return verdicts; }
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k in verdicts) verdicts[k] = v;
  }
  return verdicts;
}

const REASONS = {
  ANTI_POLLING:
    'ANTI-POLLING: You polled pipeline/task status multiple times in one turn -- the wait-and-poll antipattern. Background tasks fire notifications when done, so polling burns the turn without advancing it. The gate clears once the turn uses pipeline_digest (freshness guard) or does real work instead.',
  ANTI_IDLE:
    'ANTI-IDLE: Pipeline is running in background. The Stop gate stays closed while the pipeline runs; it clears once the pipeline completes or 20+ tool calls of substantive work land. High-leverage work meanwhile:\n1. Run index_codebase (KB stays fresh for next round)\n2. Pick next evolution targets from the suggest_evolution output and implement them\n3. Run what_did_i_forget on any recently changed files\n4. Update docs or KB entries for this round',
  FABRICATION:
    'FABRICATION DETECTED: final text asserts a quantitative invariant about pipeline state ("held steady", "stayed constant", "unchanged across runs", "same as last", etc.) without the turn containing a verification disclosure marker. In a stochastic music generator every run-level metric is different; invariance is the claim that needs proof, not the default. The gate clears once the claim is resolved one of three ways: (a) VERIFY it now via i/status or Read src/output/metrics or grep run-history, then annotate with "(verified)" / "(confirmed)"; (b) REMOVE the fabricated claim from the response; (c) EXPLICITLY qualify it with "(unverified)" / "(assumed)" / "(did not check)". Silent fabrication to bridge reasoning gaps is the antipattern this gate exists to block.',
  PSYCHO_STOP:
    'PSYCHOPATHIC-STOP: One of three defer-instead-of-do patterns fired: (A) launched a long background job + ScheduleWakeup; (B) admit-and-stop -- final text enumerated pending work with no tool calls following; (C) survey-and-ask -- final text identified violations/opportunities a directive already told you to fix, then asked permission instead of fixing ("want me to run...", "did not modify", "before any edits", "shall I"). The directive already granted authority, so the Stop gate stays closed while the defer-pattern stands; it clears once the work is executed this turn -- or, if the scope is genuinely ambiguous, once you clarify BEFORE surveying (not after).',
  ACK_SKIP:
    'ACKNOWLEDGE-AND-MOVE-ON: HME surfaced a CRITICAL/FAIL this turn but you have not made any Edit/Write calls since. "Noting" a failure, "flagging" it, saving it for a sweep, or spawning an Agent to survey instead of fixing it is the antipattern the fix_antipattern wiring exists to block. The gate clears once you diagnose the root cause, edit the offending code, and re-run the HME tool to confirm the CRITICAL cleared. If the CRITICAL is from a long-running background process that will resolve itself, saying so EXPLICITLY in text also clears it -- but fix it if you can.',
  PLAN_ABANDONMENT:
    'PLAN-ABANDONMENT DETECTED: You spawned an Agent for KB/HME work. Subagents for KB work are the abandoning-plans antipattern (KB entry 524061657661). The gate clears once the task is completed with the HME tools directly: search_knowledge, compact_knowledge, remove_knowledge, list_knowledge, memory_dream, kb_health.',
  EARLY_STOP:
    'EARLY-STOP DETECTED: This is an open-ended HME/tooling round ("do all", "anything missing", "keep going", "improve X", "push further", or similar). Your final text enumerated remaining gaps but you stopped without executing through them. The user has explicitly asked you to skip the "anything missing? / do all" ceremony -- KB entry dae793e748f9 documents the protocol. The gate stays closed while enumerated gaps are left unexecuted; it clears once you land the highest-leverage items in this same turn, or once the remaining items are genuinely low-leverage polish, need an architectural decision the user owns, or need machine access you do not have. Narrow-scope user prompts ("rename foo to bar") explicitly override this -- if you believe the user\'s intent was bounded, say so explicitly in text and continue with what you can do within that bound.',
};

module.exports = {
  name: 'anti_patterns',
  async run(ctx) {
    const v = readVerdicts();

    const pollCount = parseInt(v.POLL_COUNT, 10);
    if (Number.isFinite(pollCount) && pollCount >= 2) return ctx.deny(REASONS.ANTI_POLLING);
    if (v.IDLE_AFTER_BG === 'idle') return ctx.deny(REASONS.ANTI_IDLE);
    if (v.FABRICATION_CHECK === 'fabrication') return ctx.deny(REASONS.FABRICATION);
    if (v.PSYCHO_STOP === 'psycho') return ctx.deny(REASONS.PSYCHO_STOP);
    if (v.ACK_SKIP === 'ack_skip') return ctx.deny(REASONS.ACK_SKIP);
    if (v.ABANDON_CHECK === 'AGENT_FOR_KB') return ctx.deny(REASONS.PLAN_ABANDONMENT);
    if (v.EARLY_STOP === 'early_stop') return ctx.deny(REASONS.EARLY_STOP);

    return ctx.allow();
  },
};
