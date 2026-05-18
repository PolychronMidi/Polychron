'use strict';

const fs = require('fs');
const path = require('path');
const { sessionKey, PROJECT_ROOT } = require('./shared');

const DENY_MARKERS = [
  'Stop hook feedback:',
  'Stop hook blocking error from command:',
  'AUTO-COMPLETENESS',
  'EXHAUST PROTOCOL',
  'PreToolUse:',
  'PostToolUse:',
];

function lastUserText(payload) {
  const msgs = (payload && payload.messages) || [];
  let text = '';
  for (const m of msgs) {
    if (!m || m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') {
      text = c;
    } else if (Array.isArray(c)) {
      text = c.filter((b) => b && b.type === 'text')
        .map((b) => b.text || '').join(' ') || text;
    }
  }
  return text;
}

function userWasDeny(payload) {
  const text = lastUserText(payload);
  return Boolean(text && DENY_MARKERS.some((m) => text.includes(m)));
}

function responseHasToolUse(outBuf) {
  try {
    const outStr = (outBuf && typeof outBuf.toString === 'function') ? outBuf.toString('utf8') : '';
    if (!outStr || !outStr.trimStart().startsWith('{')) return false;
    const parsed = JSON.parse(outStr);
    if (!parsed || !Array.isArray(parsed.content)) return false;
    return parsed.content.some((b) => b && b.type === 'tool_use');
  } catch (_) {
    return false;
  }
}

function maybeStripNonSseBareAck({ payload, outBuf }) {
  try {
    const deny = userWasDeny(payload);
    const outStr = outBuf.toString('utf8');
    if (!outStr.trimStart().startsWith('{')) return null;
    const parsed = JSON.parse(outStr);
    if (!parsed || !Array.isArray(parsed.content)) return null;
    const { _isBareAck } = require('./sse_rewriters');
    let detectedAck = false;
    for (const b of parsed.content) {
      if (b && b.type === 'text' && typeof b.text === 'string' && _isBareAck(b.text)) {
        detectedAck = true;
        break;
      }
    }
    if (!detectedAck) return null;
    try {
      const ackContext = deny ? 'cascade-after-deny' : 'cascade-no-deny';
      fs.appendFileSync(
        path.join(PROJECT_ROOT, 'log', 'hme-bare-ack-strips.jsonl'),
        JSON.stringify({ ts: new Date().toISOString(), path: 'non-sse', context: ackContext }) + '\n',
      );
    } catch (_e) { /* stat is best-effort */ }
    if (!deny) return null;
    parsed.content = parsed.content.filter((b) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return true;
      return !_isBareAck(b.text);
    });
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  } catch (_e) {
    return null;
  }
}

function sendFinalResponse({ clientRes, payload, final, outStatus, outHeaders, outBuf }) {
  const willSseTransform = !final
    && (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
  if (willSseTransform || !final) {
    outHeaders = { ...outHeaders };
    delete outHeaders['content-length'];
  }
  clientRes.writeHead(outStatus, outHeaders);
  const isSseFinal = (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
  if (isSseFinal && !final) {
    const { SseTransform } = require('./sse_transform');
    const {
      dropToolUseRewrite,
      editFallbackToReadRewrite,
      readInputNormalizeRewrite,
      bashPolicyRewrite,
      runInBackgroundRewrite,
      longLeadingSleepRewrite,
      ackStripRewrite,
      slopStripRewrite,
      hallucinatedTurnPrefixStripRewrite,
      stopHookCeremonyStripRewrite,
      fpGateMarkerRewrite,
      soloRationaleTrimRewrite,
    } = require('./sse_rewriters');
    const { providerReasoningToThinkingRewrite } = require('./reasoning_to_thinking');
    const xform = new SseTransform({
      rewriters: [dropToolUseRewrite, editFallbackToReadRewrite, readInputNormalizeRewrite, providerReasoningToThinkingRewrite, fpGateMarkerRewrite, stopHookCeremonyStripRewrite, hallucinatedTurnPrefixStripRewrite, bashPolicyRewrite, longLeadingSleepRewrite, runInBackgroundRewrite, ackStripRewrite, slopStripRewrite, soloRationaleTrimRewrite],
    });
    try {
      const sessionId = payload ? sessionKey(payload) : '';
      if (sessionId) xform._ctx.set('session_id', sessionId);
      const text = lastUserText(payload);
      const denyHit = Boolean(text && DENY_MARKERS.some((m) => text.includes(m)));
      if (denyHit) xform._ctx.set('priorUserWasDeny', true);
      try {
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-proxy-ackstrip.log'),
          `[${new Date().toISOString()}] sse-setup priorUserWasDeny=${denyHit} lastUserHead=${JSON.stringify(text.slice(0,80))}\n`,
        );
      } catch (_e) { /* best-effort */ }
    } catch (_e) { /* best-effort */ }
    xform.pipe(clientRes);
    xform.end(outBuf);
    return;
  }
  const stripped = maybeStripNonSseBareAck({ payload, outBuf });
  const rewritten = _maybeRewriteNonSseEdit(stripped || outBuf);
  clientRes.end(rewritten);
}

function _maybeRewriteNonSseEdit(buf) {
  const text = typeof buf === 'string' ? buf : Buffer.isBuffer(buf) ? buf.toString('utf8') : '';
  if (!text || text.charAt(0) !== '{') return buf;
  let body;
  try { body = JSON.parse(text); } catch (_e) { return buf; }
  if (!body || typeof body !== 'object') return buf;
  const { rewriteNonSseEditFallback } = require('./edit_validation');
  const { body: next, count } = rewriteNonSseEditFallback(body, { checkFs: true });
  if (!count) return buf;
  const out = JSON.stringify(next);
  return Buffer.isBuffer(buf) ? Buffer.from(out, 'utf8') : out;
}

function maybeRunStopFallback({ isAnthropic, payload, outBuf, lifecycleInactive, runInlineFallback }) {
  if (!isAnthropic || responseHasToolUse(outBuf) || !lifecycleInactive('Stop')) return;
  try {
    const stopSession = payload ? sessionKey(payload) : 'unknown';
    const stdin = JSON.stringify({ session_id: stopSession, transcript_path: '' });
    runInlineFallback('Stop', stdin);
  } catch (err) {
    console.error('inline Stop threw:', err.message);
  }
}

module.exports = {
  sendFinalResponse,
  maybeRunStopFallback,
  responseHasToolUse,
  lastUserText,
  userWasDeny,
};
