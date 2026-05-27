'use strict';

const {
  COMPL_MAX,
  REASONS,
  completionTurnKey,
  loadComplStore,
  saveComplStore,
} = require('../context');
const { assistantToolUsesSinceLastUserPrompt } = require('../transcript');
const { unfinishedTaskDebt } = require('../task_debt');

function isNothingMissedResponse(text) {
  if (!text) return false;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 80) return false;
  const re = /^(nothing\s+missed|confirmed\s+nothing\s+(missed|remains|left)|nothing\s+remains|all\s+(set|done|clear))[.!]?$/i;
  return re.test(trimmed);
}

function isBareCompletionMarker(text) {
  if (!text) return false;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 32) return false;
  return /^(\[?(success|ok|done|complete|completed|noted|acknowledged|continue)\.?\]?|k\.?|✓|✔|fp[-_ ]?gate(\s+marker)?)$/i.test(trimmed);
}

// anti-fork-begin: speculation-regexes min=6
const SPECULATION_RES = [
  /\bi\s+(worry|suspect|imagine|wonder|guess|think\s+(that|maybe))\b[^.!?\n]{1,120}/gi,
  /\b(this|that|it)\s+(might|may|could)\s+(be|have|cause|break|miss)\b[^.!?\n]{1,120}/gi,
  /\b(probably|likely|presumably|seems?\s+like|appears?\s+to)\b[^.!?\n]{1,120}/gi,
  /\b(worth\s+(investigating|verifying|checking|confirming|exploring)|might\s+be\s+worth)\b[^.!?\n]{1,120}/gi,
  /\b(open\s+question|outstanding\s+question|haven'?t\s+verified)\b[^.!?\n]{1,120}/gi,
  /\b(my\s+(concern|worry)|the\s+concern\s+(is|here))\b[^.!?\n]{1,120}/gi,
];
// anti-fork-end: speculation-regexes

function scanSpeculation(text) {
  if (!text) return [];
  let stripped = text.replace(/```[\s\S]*?```/g, ' ');
  stripped = stripped.replace(/`[^`\n]*`/g, ' ');
  stripped = stripped.replace(/"[^"\n]*"/g, ' ');
  stripped = stripped.replace(/'[^'\n]*'/g, ' ');
  const seen = new Set();
  const hits = [];
  for (const re of SPECULATION_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const snippet = m[0].trim().replace(/\s+/g, ' ').slice(0, 120);
      const key = snippet.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(snippet);
      if (hits.length >= 5) break;
    }
    if (hits.length >= 5) break;
  }
  return hits;
}

function isBroadCompletionPrompt(text) {
  return /\b(do\s+all|all\s+fully|complete\s+fully|complete\s+all|full\s+list|entire\s+list|everything|anything\s+missing|all\s+suggestions|complete\s+the\s+suggestions|does\s+that\s+complete\s+all|are\s+all\s+\d+|completion\s+for\s+the\s+\d+(st|nd|rd|th)\s+time)\b/i.test(text || '');
}

function scanIncompleteCompletionClaims(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const re = /\b(partial|not\s+complete|not\s+done|remaining|still\s+needs?|todo|pending|scaffold|foundation|next\s+(step|action)|would\s+need)\b[^.!?\n]{0,120}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (s) out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

function denyHits(state, reasonKey, intro, hits) {
  const enumerated = hits.map((x, i) => `  ${i + 1}. "${x}"`).join('\n');
  return state.deny(reasonKey, `${intro}\n\n${enumerated}`);
}

const completionBudgetCheck = {
  name: 'completion-budget',
  evaluate(state) {
    state.turnKey = completionTurnKey(state.lastUserInfo, state.lastUser);
    state.store = loadComplStore();
    state.count = parseInt(state.store[state.turnKey], 10) || 0;
    if (state.count >= COMPL_MAX) return state.ctx.allow();
    state.next = state.count + 1;
    return null;
  },
};

const roundTwoNothingMissedCheck = {
  name: 'round-two-nothing-missed',
  evaluate(state) {
    if (state.next !== 2) return null;
    if (!isNothingMissedResponse(state.lastAssistantText) || unfinishedTaskDebt(state.transcriptPath)) return null;
    state.store[state.turnKey] = COMPL_MAX;
    saveComplStore(state.store);
    return state.ctx.allow();
  },
};

const bareCompletionMarkerCheck = {
  name: 'bare-completion-marker',
  evaluate(state) {
    const bypass = isBareCompletionMarker(state.lastAssistantText);
    const toolUses = assistantToolUsesSinceLastUserPrompt(state.transcriptPath);
    if (!bypass || toolUses !== 0) return null;
    return state.deny('FP_GATE_SUBVERSION',
      'FP-GATE SUBVERSION DETECTED: your last reply was a bare completion marker ([SUCCESS] / [OK] / k. / etc.) with zero tool calls since the most recent user prompt. The fp-gate marker is reserved for turns where the requested work is actually done -- using it to short-circuit an AUTO-COMPLETENESS CHECK is fraud. Resume the work the user asked for and emit a tool call. The completeness counter is NOT advanced by this denial; another bare marker reply will hit this same gate.'
    );
  },
};

const advanceCompletenessCounterCheck = {
  name: 'advance-completeness-counter',
  evaluate(state) {
    state.store[state.turnKey] = state.next;
    saveComplStore(state.store);
    return null;
  },
};

const broadCompletionDebtCheck = {
  name: 'broad-completion-debt',
  evaluate(state) {
    if (state.next !== 1 || !isBroadCompletionPrompt(state.lastUser)) return null;
    const hits = scanIncompleteCompletionClaims(state.lastAssistantText);
    if (!hits.length) return null;
    const intro = `${REASONS.COMPL_ROUND_1}\n\nBROAD-SCOPE COMPLETION DEBT: the user asked for comprehensive completion, but the last response used incomplete-status language. Do not stop at a status correction. Convert the broad request into explicit repo-verifiable criteria, implement the remaining items, run verification, and only then close.`;
    return denyHits(state, 'BROAD_SCOPE_COMPLETION_DEBT', intro, hits);
  },
};

const speculationDebtCheck = {
  name: 'speculation-debt',
  evaluate(state) {
    if (state.next !== 1) return null;
    const hits = scanSpeculation(state.lastAssistantText);
    if (!hits.length) return null;
    const intro = `${REASONS.COMPL_ROUND_1}\n\nSPECULATION-DEBT SCAN: your last response contained ${hits.length} speculation-shaped phrase(s). Each must resolve to evidence (grep/Read the relevant code and either confirm or refute) or be dropped before stopping. NEVER leave speculation as a parting note -- it becomes permanent fog otherwise.`;
    return denyHits(state, 'SPECULATION_DEBT', intro, hits);
  },
};

const autoCompletenessCheck = {
  name: 'auto-completeness',
  evaluate(state) {
    return state.next === 1
      ? state.deny('COMPL_ROUND_1', REASONS.COMPL_ROUND_1)
      : state.deny('COMPL_ROUND_2', REASONS.COMPL_ROUND_2);
  },
};

module.exports = {
  advanceCompletenessCounterCheck,
  autoCompletenessCheck,
  bareCompletionMarkerCheck,
  broadCompletionDebtCheck,
  completionBudgetCheck,
  isBareCompletionMarker,
  isBroadCompletionPrompt,
  isNothingMissedResponse,
  roundTwoNothingMissedCheck,
  scanIncompleteCompletionClaims,
  scanSpeculation,
  speculationDebtCheck,
};
