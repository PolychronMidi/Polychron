'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const FP_DENY_MARKERS = [
  'Stop hook feedback:',
  'Stop hook blocking error from command:',
  'AUTO-COMPLETENESS',
  'EXHAUST PROTOCOL',
  'PSYCHOPATHIC-STOP',
  'STOP-WORK ANTIPATTERN',
  'ADVISOR DOCTRINE',
  'PHANTOM CAPABILITY',
  'PHANTOM PARAPHRASE',
  'SPECULATION-DEBT SCAN',
  'SCOPE-ESCAPE VIOLATION',
  'NEXUS --',
  'VERIFICATION DOCTRINE',
  'SYSTEMATIC-DEBUGGING PHASE GATE',
];

const FP_TEXT_DELTA_RE = /"type"\s*:\s*"text_delta"[\s\S]{0,200}\[FP-CHECK:\s*yes\]|\[FP-CHECK:\s*yes\][\s\S]{0,200}"type"\s*:\s*"text_delta"/;

function _lastUserText(payload) {
  const msgs = (payload && payload.messages) || [];
  let text = '';
  for (const m of msgs) {
    if (!m || m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) {
      text = c.filter((b) => b && b.type === 'text')
        .map((b) => b.text || '').join(' ') || text;
    }
  }
  return text;
}

function createFpGateScanner({ payload, chunks, destroyUpstream }) {
  let triggered = false;
  let trailingBuf = '';
  let eligible = false;
  try {
    const text = _lastUserText(payload);
    eligible = Boolean(text && FP_DENY_MARKERS.some((m) => text.includes(m)));
  } catch (_e) { /* best-effort -- if detection fails, no kill */ }
  return function scanFpGateChunk(chunk) {
    if (!eligible || triggered) return;
    try {
      const scan = trailingBuf + chunk.toString('utf8');
      if (FP_TEXT_DELTA_RE.test(scan)) {
        triggered = true;
        try {
          fs.appendFileSync(
            path.join(PROJECT_ROOT, 'log', 'hme-fp-gate-kills.jsonl'),
            JSON.stringify({
              ts: new Date().toISOString(),
              bytes_before_kill: chunks.reduce((acc, b) => acc + b.length, 0),
            }) + '\n',
          );
        } catch (_e) { /* stat is best-effort */ }
        try { destroyUpstream(); } catch (_e) { /* ignore */ }
      } else {
        trailingBuf = scan.slice(-600);
      }
    } catch (_e) { /* scan is best-effort */ }
  };
}

module.exports = { createFpGateScanner, _lastUserText };
