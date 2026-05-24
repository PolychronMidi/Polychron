'use strict';

// Strip bare-ack text after stop-hook denies; silence-equivalent spam.
const _ACK_PATTERNS = [
  /^\s*ok[.!]?\s*$/i,
  /^\s*done[.!]?\s*$/i,
  /^\s*noted[.!]?\s*$/i,
  /^\s*got\s+it[.!]?\s*$/i,
  /^\s*ack[.!]?\s*$/i,
  /^\s*acknowledged[.!]?\s*$/i,
  /^\s*k[.!]?\s*$/i,
  /^\s*sure[.!]?\s*$/i,
  /^\s*yes[.!]?\s*$/i,
  /^\s*yep[.!]?\s*$/i,
  /^\s*yeah[.!]?\s*$/i,
  /^\s*will\s+do[.!]?\s*$/i,
  /^\s*on\s+it[.!]?\s*$/i,
  /^\s*understood[.!]?\s*$/i,
  /^\s*roger[.!]?\s*$/i,
  /^\s*right[.!]?\s*$/i,
  /^\s*proceeding[.!]?\s*$/i,
  /^\s*continuing[.!]?\s*$/i,
  /^\s*resuming[.!]?\s*$/i,
];

// Catch responses the keyword patterns miss: empty, bare punctuation
// (`.`, `..`, `!?`), or single-glyph non-letter responses that the model
// emits under stop-hook pressure to dodge the no-text-output gate
// without saying anything substantive.
function _isMinimalAck(text) {
  const t = (text || '').trim();
  if (!t) return true;
  if (/^[\s.!?;:,\-_*~`]+$/.test(t)) return true;
  if (t.length <= 2 && !/[a-z0-9]/i.test(t)) return true;
  return false;
}

// Drop assistant text that fabricates a `Human:` / `Assistant:` turn prefix.
function _isHallucinatedTurnPrefix(text) {
  if (typeof text !== 'string') return false;
  // Pure prefix tokens: "Human:", "Assistant:", or repeated.
  if (/^\s*(?:(?:Human|Assistant)\s*:\s*){1,}\s*$/.test(text)) return true;
  // Prefix followed by ANYTHING (free-form fabricated turn, system-
  // reminder echo, stop-hook payload echo, anything else). Anchored
  // at start so we only catch the FAKE-TURN-START shape, not mid-text
  // mentions of "Human:" in legitimate prose.
  if (/^\s*(?:Human|Assistant)\s*:\s+\S/.test(text)) return true;
  return false;
}

// Drop literal solo-rationale ceremony; keep generic rationale requests intact.
function _isCeremonyDodge(text) {
  if (typeof text !== 'string') return false;
  // Block-start anchor only. Trailing solo-rationale paragraphs in
  // otherwise-substantive responses are handled SURGICALLY by
  // _trimSoloRationaleParagraph (called from soloRationaleTrimRewrite)
  // -- whole-block strip would nuke the substantive content too.
  if (/^\s*Solo[- ](?:rationale|justification)\s*[:.]/i.test(text)) return true;
  if (/^\s*Why\s+solo\s+(?:was|is)\s+(?:right|the\s+(?:right|correct)\s+call|appropriate|correct)/i.test(text)) return true;
  if (/^\s*Solo\s+(?:was|is)\s+(?:right|correct|appropriate|the\s+(?:right|correct)\s+call)\b/i.test(text)) return true;
  return false;
}

// Surgical trim of trailing solo-rationale paragraph (mid-text, after blank line).
function _trimSoloRationaleParagraph(text) {
  if (typeof text !== 'string' || !text) return { text, trimmed: false };
  const patterns = [
    /\n\s*\n\s*Solo[- ](?:rationale|justification)\b[\s\S]*$/i,
    /\n\s*\n\s*Why\s+solo\s+(?:was|is)\s+(?:right|the\s+(?:right|correct)\s+call|appropriate|correct)\b[\s\S]*$/i,
    /\n\s*\n\s*Solo\s+(?:was|is)\s+(?:right|correct|appropriate|the\s+(?:right|correct)\s+call)\b[\s\S]*$/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return { text: text.slice(0, m.index).replace(/\s+$/, ''), trimmed: true };
  }
  return { text, trimmed: false };
}

function _isBareAck(text) {
  if (typeof text !== 'string') return false;
  if (_ACK_PATTERNS.some((pat) => pat.test(text))) return true;
  if (_isMinimalAck(text)) return true;
  // Turn-prefix hallucinations are also bare-ack class for the
  // ackStripRewrite path. A separate always-on rewriter
  // (hallucinatedTurnPrefixStripRewrite below) catches them
  // regardless of priorUserWasDeny gate.
  if (_isHallucinatedTurnPrefix(text)) return true;
  // Stop-hook ceremony-dodge: same treatment -- always spam, the
  // always-on rewriter strips it regardless of gate.
  if (_isCeremonyDodge(text)) return true;
  return false;
}

// Stop-hook ceremony detector: replace bypass explanations with `.`.
const _STOP_HOOK_CEREMONY_PATTERNS = [
  // Tier reclassification dance ("Tier reclassify per the doctrine...")
  /\btier\s+reclass\w*/i,
  /\bre[\s-]?evaluat\w+\s+(the\s+)?tier/i,
  /\b(?:re[\s-]?)?classify(?:ing)?\s+(?:the\s+)?(?:tier|turn|effort|work)/i,
  // "this turn was status-report / research / read-only"
  /\bthis\s+turn\s+(?:was|is)\s+(?:a\s+)?(?:status[\s-]?report|research|read[\s-]?only|brief|trivial|light(?:weight)?)/i,
  // Tier name dismissals ("not E4", "not Deep", "not Comprehensive")
  /\b(?:not\s+|isn'?t\s+)e[45]\b(?:\s+work|\s+effort|\s+tier|\s+floor)?/i,
  /\b(?:not|isn'?t)\s+(?:deep|comprehensive)\s+(?:effort|work|tier)/i,
  // "Per the doctrine's offered path" -- bypass framing using the rule's
  // own language as cover.
  /\bper\s+(?:the\s+)?(?:doctrine|hook|gate|stop[\s-]?hook|advisor)['']?s?\s+(?:own\s+)?(?:offered\s+)?path/i,
  /\b(?:the\s+)?(?:three|two)\s+offered\s+paths/i,
  // "The hook is firing on" / "the gate misclassified"
  /\bthe\s+(?:hook|gate|detector|doctrine|advisor|classifier|exhaust|psycho)\s+(?:is\s+)?(?:firing\s+on|misclassif|mis[\s-]?tagg|mis[\s-]?fired?|fired\s+on)/i,
  // "doesn't apply" excuses
  /\b(?:false[\s-]positive|floor\s+doesn'?t\s+apply|gate\s+doesn'?t\s+apply|doctrine\s+doesn'?t\s+apply|rule\s+doesn'?t\s+apply)/i,
  /\b(?:advisor|doctrine|gate|hook|rule)\s+(?:doesn'?t|does\s+not)\s+apply/i,
  // Solo-rationale shapes (block-start only; trailing-paragraph case
  // is handled surgically by soloRationaleTrimRewrite, not here).
  /^\s*solo[\s-](?:rationale|justification)\s*[:.]/i,
  /^\s*why\s+solo\s+(?:was|is)\s+(?:right|correct|the\s+(?:right|correct))/i,
  /^\s*solo\s+(?:was|is)\s+(?:right|correct|appropriate|the\s+(?:right|correct)\s+call)/i,
  // "The rule fired but..." / "the gate misfired"
  /\b(?:the\s+)?(?:rule|hook|gate|detector|doctrine)\s+(?:fired|misfired)\s+but/i,
  // "Acknowledged" as standalone ceremonial opener (not real new-info ack)
  /^\s*acknowledg(?:e|ed|ing)[\s.,:]+(?:the\s+)?(?:hook|gate|doctrine|stop|rule|warning|flag)/i,
];

function _isStopHookCeremony(text) {
  if (typeof text !== 'string' || !text) return false;
  // Scan only the first 200 chars to keep this conservative -- long
  // substantive responses that incidentally use one of these tokens
  // deep in the body are not affected.
  const lead = text.slice(0, 200);
  return _STOP_HOOK_CEREMONY_PATTERNS.some((p) => p.test(lead));
}

// Stop-hook ceremony strip: emit `.`, then suppress later content events.

module.exports = {
  _isBareAck,
  _isHallucinatedTurnPrefix,
  _isCeremonyDodge,
  _isStopHookCeremony,
  _trimSoloRationaleParagraph,
};
