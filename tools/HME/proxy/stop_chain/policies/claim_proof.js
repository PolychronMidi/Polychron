'use strict';

// Stop-chain claim-proof guard. Complements work_checks (which gates completion
// LANGUAGE) by gating the PROOF dimension: did the turn that claims "fixed / all

const guard = require('../../claim_proof_guard');
const { lastAssistantText, _assistantToolUses } = require('./work_checks/transcript');

const fs = require('fs');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'Update']);
const VERIFY_TOOLS = new Set(['Bash']);

function _sameTurnToolUses(transcriptPath) {
  if (!transcriptPath) return [];
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); } catch (_e) { return []; }
  const entries = [];
  let lastUserIdx = -1;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    entries.push(entry);
    const role = entry.type || entry.role;
    if (role === 'user') {
      const c = (entry.message && entry.message.content) || entry.content;
      const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join(' ') : '');
      if (text.trim() && !/^\[SYSTEM NOTIFICATION/.test(text) && !/^Stop hook feedback:/.test(text)) lastUserIdx = entries.length - 1;
    }
  }
  if (lastUserIdx < 0) return [];
  const names = [];
  for (let i = lastUserIdx + 1; i < entries.length; i++) {
    const entry = entries[i];
    if ((entry.type || entry.role) !== 'assistant') continue;
    for (const b of _assistantToolUses(entry)) names.push(String(b.name || ''));
  }
  return names;
}

function _emitVerdict(root, claimClass, decision, shadow, details = {}) {
  try {
    require('../../coherence_events').appendEvent(root, {
      kind: 'policy_decision', subject: 'stop:claim_proof', intent: `claim_class=${claimClass}`,
      evidence: [], coherence_delta: decision === 'deny' ? -1 : 0, proofClass: 'policy',
      // edits/verified are the TP/FP discriminator: a deny with verified=false is a
      // genuine unverified-claim catch (signal); verified=true means the turn ran a
      meta: { decision, shadow: Boolean(shadow), edits: Number(details.edits || 0), verified: Boolean(details.verified) },
    });
  } catch (_e) { /* silent-ok: ledger is advisory */ }
}

function run(ctx) {
  const transcript = ctx.payload && ctx.payload.transcript_path;
  const claimText = lastAssistantText(transcript);
  if (!claimText) return ctx.allow();
  const claimClass = guard.classifyClaim(claimText);
  if (claimClass === 'ordinary' || claimClass === 'hypothesis') return ctx.allow();

  const toolNames = _sameTurnToolUses(transcript);
  const editsThisTurn = toolNames.filter((n) => EDIT_TOOLS.has(n)).length;
  const verifiedThisTurn = toolNames.some((n) => VERIFY_TOOLS.has(n));

  // Build the evidence event the substrate's guard reasons over.
  const events = verifiedThisTurn
    ? [{ kind: 'test', evidence: toolNames.filter((n) => VERIFY_TOOLS.has(n)), proof_class: 'executed' }]
    : [];
  const verdict = guard.evaluateClaim(claimText, events);
  if (verdict.supported) return ctx.allow();

  // Strict mode enforces (deny); non-strict runs in shadow -- it still emits the
  // verdict event so `i/why mode=debt` can show whether enabling the hard deny
  const strict = (() => { try { return require('../../strict_mode').isStrictMode(); } catch (_e) { return false; } })();

  if (guard.isAbsoluteCompletion(claimText) && editsThisTurn > 0) {
    _emitVerdict(ctx.projectRoot, claimClass, 'deny', !strict, { edits: editsThisTurn, verified: verifiedThisTurn });
    if (strict) {
      return ctx.deny(
        'CLAIM-PROOF: this turn edited code and made an absolute completion claim ("all/every ... done/fixed/passing"), '
        + 'but ran no verification (no Bash/test tool call since the last prompt). Run the relevant test or check, '
        + 'then stop -- or restate the claim scoped to what you actually verified.',
      );
    }
    return ctx.instruct(
      `CLAIM-PROOF (shadow): "${claimText.slice(0, 80)}" is an absolute completion claim after edits with no same-turn `
      + 'verification. In strict mode this would block; run the check before claiming.',
    );
  }
  _emitVerdict(ctx.projectRoot, claimClass, 'instruct', !strict, { edits: editsThisTurn, verified: verifiedThisTurn });
  return ctx.instruct(
    `CLAIM-PROOF: "${claimText.slice(0, 80)}" reads as a ${claimClass} completion claim with no same-turn verification. `
    + 'Prefer running the check before claiming, or scope the claim to what was verified.',
  );
}

module.exports = { name: 'claim_proof', run };
