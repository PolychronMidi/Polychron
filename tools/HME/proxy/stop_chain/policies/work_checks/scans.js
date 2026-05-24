'use strict';

// Match exact "nothing missed"-shape no-op responses (<=80 chars, equals one
// of the declarations). Long responses with the phrase mid-sentence don't match.
function isNothingMissedResponse(text) {
  if (!text) return false;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 80) return false;  // long responses always run round 2
  const re = /^(nothing\s+missed|confirmed\s+nothing\s+(missed|remains|left)|nothing\s+remains|all\s+(set|done|clear))[.!]?$/i;
  return re.test(trimmed);
}

// Bare-marker bypass shape: `[SUCCESS]`, `[OK]`, `K.`, single-word ceremony.
// The model is supposed to use the fp-gate marker only when work is genuinely
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
  // Strip code fences + backticks + quoted spans before scanning so
  // documentation/examples don't false-fire.
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

function scanNextActionDebt(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const re = /\bnext\s+(action|step)\s+(is|would\s+be|will\s+be|should\s+be|remains?|needed|to\s+do)\b[^.!?\n]{0,160}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (s) out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}

function scanWorkDebtAdmission(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const safeNegation = /\b(no|zero|nothing)\s+(remaining|remains|left|pending|open|outstanding|unfinished|incomplete)\b/i;
  const re = /\b(not\s+(complete|done|finished|closed)|does(?:n['’]?t|\s+not)\s+complete|not\s+fully\s+(complete|closed|done)|remaining\s+(work|gap|gaps|item|items|issue|issues|todo|todos|finding|findings|violation|violations|offender|offenders)|still\s+(needs?|pending|open|outstanding|unfinished|incomplete)|pending\s+(work|item|items|todo|todos|fix|fixes)|follow-?up\s+(needed|required|remains?)|limitation\s*:|not\s+completed\s+from|before\s+.*diversion|resume\s+exactly\s+there|(?:i['’]?m|i\s+am|i\s+will|i['’]?ll|we\s+will)\s+(fixing|going\s+to|running|patching|continuing|executing|doing|checking|verifying)|(?:fixing|patching|running|continuing|executing|doing|checking|verifying)\s+(now|next|that|this|the))\b[^.!?\n]{0,180}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (!s || safeNegation.test(s)) continue;
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}


module.exports = {
  isNothingMissedResponse,
  isBareCompletionMarker,
  scanSpeculation,
  isBroadCompletionPrompt,
  scanIncompleteCompletionClaims,
  scanNextActionDebt,
  scanWorkDebtAdmission,
};
