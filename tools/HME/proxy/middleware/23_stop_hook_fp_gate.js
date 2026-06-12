'use strict';
/**
 * Stop-hook false-positive gate.
 *
 * When the prior user message contains a stop-hook payload marker
 * (Stop hook feedback / AUTO-COMPLETENESS / EXHAUST / advisor doctrine
 * / etc.), append an instruction at the END of that message forcing the
 * agent to emit a structured decision marker as the first line of its
 * reply:
 *
 *   `[FP-CHECK: yes]` -- the flag is a false positive against the
 *                        agent's prior turn. Reply is JUST the marker.
 *   `[FP-CHECK: no]`  -- the flag is legitimate. Marker on its own
 *                        line, then substantive work addressing it.
 *
 * The companion SSE rewriter (`stopHookFpGateStripRewrite` in
 * sse_rewriters.js) detects the marker in the streamed response and
 * routes:
 *   - `yes` -> truncate the response to a single `.` and drop all
 *             subsequent content events. Saves next-turn context burn
 *             from carrying ceremony forward in transcript.
 *   - `no`  -> strip the marker line, pass through the rest verbatim.
 *
 * Why a structured marker rather than text-pattern detection: prose
 * detection has misclassification risk in both directions. The
 * structured marker forces the agent to make the call explicitly,
 * eliminating the bypass-explanation dance entirely.
 *
 * Cache-safe: like lifesaver_inject, this appends to the LAST USER
 * MESSAGE (not payload.system), so the system+tools cache prefix
 * stays stable across turns.
 */

const fs = require('fs');
const path = require('path');
const { RUNTIME_DIR } = require('../shared');
const FP_GATE_ARMED_FLAG = path.join(RUNTIME_DIR, 'fp-gate-armed.flag');

const STOP_HOOK_MARKERS = [
  'Stop hook feedback:',
  'Stop hook blocking error from command:',
  'AUTO-COMPLETENESS CHECK',
  'EXHAUST PROTOCOL VIOLATION',
  'PSYCHOPATHIC-STOP',
  'STOP-WORK ANTIPATTERN',
  'ADVISOR DOCTRINE',
  'PHASE GATE VIOLATION',
  'PILE-ON ANTIPATTERN',
  'PHANTOM CAPABILITY',
  'PHANTOM PARAPHRASE',
  'SUMMARY MISSING',
  'SUMMARY MALFORMED',
  'LIVE-PROBE VIOLATION',
  'MINIMAL MODE FORMAT',
  'SPECULATION-DEBT SCAN',
  'IGNORE-AND-TRAMPLE',
  'SCOPE-ESCAPE VIOLATION',
  'NEXUS --',
  'VERIFICATION DOCTRINE',
  'SYSTEMATIC-DEBUGGING PHASE GATE',
];

const FP_INSTRUCTION = [
  '',
  '',
  '[stop-hook fp-gate -- proxy-injected]',
  'Your reply MUST begin with EXACTLY one of these markers on its own line:',
  '  [FP-CHECK: yes]  -- this stop-hook flag is a false positive against your prior turn (e.g. tier misclassified, gate matched legitimate prose, detector logic bug). Emit ONLY the marker. Nothing else. The proxy truncates the rest.',
  '  [FP-CHECK: no]   -- the flag is legitimate. Emit the marker, then proceed with substantive work addressing it (run the verification command, do the investigation, write the fix). NO rationale text, NO tier-reclassify dance, NO solo-rationale clause -- those are the exact ceremony shapes the proxy strips.',
  '',
  'Pick the honest one. The structured marker eliminates the bypass-explanation dance: yes means yes (and you owe nothing more), no means no (and you owe substantive work, not prose about why the gate misfired).',
].join('\n');

module.exports = {
  name: 'stop_hook_fp_gate',

  onRequest({ payload, ctx }) {
    if (process.env.HME_PROXY_LEAN_MODE === '1') return;
    if (!payload || !Array.isArray(payload.messages)) return;

    const lastUser = [...payload.messages].reverse().find(
      (m) => m && m.role === 'user'
    );
    if (!lastUser) return;

    // Extract last user message text for marker detection.
    let userText = '';
    if (typeof lastUser.content === 'string') {
      userText = lastUser.content;
    } else if (Array.isArray(lastUser.content)) {
      for (const b of lastUser.content) {
        if (b && b.type === 'text' && typeof b.text === 'string') {
          userText += b.text + '\n';
        }
      }
    }
    if (!userText) return;

    const isStopHook = STOP_HOOK_MARKERS.some((m) => userText.includes(m));
    if (!isStopHook) return;

    // Turn-specific: only inject when the prior turn ACTUALLY denied
    let armed = false;
    try { armed = fs.existsSync(FP_GATE_ARMED_FLAG); } catch (_e) { /* ignore */ }
    if (!armed) return;
    try { fs.unlinkSync(FP_GATE_ARMED_FLAG); } catch (_e) { /* ignore */ }

    // Idempotent: if the instruction is already present (e.g. retry),
    // don't append again.
    if (userText.includes('[stop-hook fp-gate -- proxy-injected]')) return;

    if (typeof lastUser.content === 'string') {
      lastUser.content = lastUser.content + FP_INSTRUCTION;
    } else if (Array.isArray(lastUser.content)) {
      lastUser.content.push({ type: 'text', text: FP_INSTRUCTION });
    } else {
      lastUser.content = [{ type: 'text', text: FP_INSTRUCTION }];
    }
    ctx.markDirty();
  },
};
