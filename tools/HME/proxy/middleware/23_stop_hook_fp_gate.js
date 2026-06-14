// Stop-hook false-positive gate asks the model for an explicit [FP-CHECK: yes|no] marker.
// The SSE companion strips or truncates by marker so hook UI ceremony does not persist.

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
