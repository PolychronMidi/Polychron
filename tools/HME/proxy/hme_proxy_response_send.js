'use strict';

const fs = require('fs');
const path = require('path');
const { sessionKey, PROJECT_ROOT } = require('./shared');
const { recordProxyFailure } = require('./middleware/_middleware_throw_lifesaver');

const DENY_MARKERS = [
  'Stop hook feedback:',
  'Stop hook blocking error from command:',
  'AUTO-COMPLETENESS',
  'EXHAUST PROTOCOL',
  'PreToolUse:',
  'PostToolUse:',
];

function writeMinimalStopSse(res, model = 'hme-proxy') {
  const id = `proxy_${Date.now()}`;
  const events = [
    ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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
  // silent-ok: malformed non-SSE JSON cannot contain parsed tool_use; raw response is left unchanged for normal downstream handling.
  } catch (_) {
    return false;
  }
}

function responseHasErrorEvent(outBuf) {
  try {
    const outStr = (outBuf && typeof outBuf.toString === 'function') ? outBuf.toString('utf8') : '';
    if (!outStr) return false;
    if (/(^|\n)event:\s*error\b/m.test(outStr)) return true;
    if (!outStr.trimStart().startsWith('{')) return false;
    const parsed = JSON.parse(outStr);
    return Boolean(parsed && (parsed.type === 'error' || parsed.error));
  // silent-ok: malformed response JSON cannot prove an error envelope; raw response/status is preserved for caller.
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
  // silent-ok: bare-ack stripping is post-response hygiene; parse/strip failure preserves original upstream body.
  } catch (_e) {
    return null;
  }
}

function maybeStripNonSseHookUiEcho({ outBuf, projectRoot = PROJECT_ROOT }) {
  try {
    const outStr = outBuf.toString('utf8');
    if (!outStr.trimStart().startsWith('{')) return null;
    const parsed = JSON.parse(outStr);
    if (!parsed || !Array.isArray(parsed.content)) return null;
    const { stripHookUiEchoText } = require('./hook_ui_echo_guard');
    let changed = false;
    const nextContent = [];
    for (const b of parsed.content) {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') {
        nextContent.push(b);
        continue;
      }
      const stripped = stripHookUiEchoText(b.text, {}, { projectRoot, source: 'response-json' });
      if (stripped !== b.text) changed = true;
      if (stripped.trim()) nextContent.push({ ...b, text: stripped });
    }
    if (!changed) return null;
    parsed.content = nextContent;
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  } catch (err) {
    recordProxyFailure(projectRoot, 'response-json-hook-ui-echo-strip', err);
    return null;
  }
}

function sendFinalResponse({ clientRes, payload, final, outStatus, outHeaders, outBuf, projectRoot = PROJECT_ROOT }) {
  const willSseTransform = !final
    && (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
  if (willSseTransform || !final) {
    outHeaders = { ...outHeaders };
    delete outHeaders['content-length'];
  }
  if (outBuf && outBuf.length === 0) {
    console.error('sendFinalResponse: outBuf is empty; closing with minimal stop SSE');
    clientRes.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    writeMinimalStopSse(clientRes, payload && payload.model || 'hme-proxy');
    clientRes.end();
    return;
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
      slopStripRewrite,
      stopHookRewritersForSlot,
    } = require('./sse_rewriters');
    const { providerReasoningToThinkingRewrite } = require('./reasoning_to_thinking');
    const { asciiStripRewrite } = require('./sse_ascii_strip_rewriter');
    const xform = new SseTransform({
      rewriters: [
        dropToolUseRewrite,
        editFallbackToReadRewrite,
        readInputNormalizeRewrite,
        providerReasoningToThinkingRewrite,
        asciiStripRewrite,
        ...stopHookRewritersForSlot('pre-tool'),
        bashPolicyRewrite,
        longLeadingSleepRewrite,
        runInBackgroundRewrite,
        ...stopHookRewritersForSlot('post-tool-pre-slop'),
        slopStripRewrite,
        ...stopHookRewritersForSlot('post-slop'),
      ],
    });
    try {
      const sessionId = payload ? sessionKey(payload) : '';
      if (sessionId) xform._ctx.set('session_id', sessionId);
      xform._ctx.set('projectRoot', projectRoot);
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
    // Raw-wire tap: capture the EXACT post-transform bytes streamed to the
    // client (the dump only has pre-transform outBuf). Fan-out preserves
    // backpressure; gated on trace so it adds nothing when off.
    if (process.env.HME_PROXY_RESPONSE_TRACE === '1') {
      try {
        const { PassThrough } = require('stream');
        const tap = new PassThrough();
        const dir = path.join(projectRoot, 'tmp', 'blank-debug');
        fs.mkdirSync(dir, { recursive: true });
        const wirePath = path.join(dir, `wire-${Date.now()}-${process.pid}.sse`);
        const sink = fs.createWriteStream(wirePath);
        sink.on('error', () => {});
        xform.pipe(tap);
        tap.pipe(clientRes);
        tap.pipe(sink);
        xform.end(outBuf);
        return;
      } catch (_e) { /* fall through to untapped pipe */ }
    }
    xform.pipe(clientRes);
    xform.end(outBuf);
    return;
  }
  const hookUiStripped = maybeStripNonSseHookUiEcho({ outBuf, projectRoot });
  const stripped = maybeStripNonSseBareAck({ payload, outBuf: hookUiStripped || outBuf });
  const rewritten = _maybeRewriteNonSseEdit(stripped || hookUiStripped || outBuf, payload);
  clientRes.end(rewritten);
}

function _maybeRewriteNonSseEdit(buf, payload) {
  const text = typeof buf === 'string' ? buf : Buffer.isBuffer(buf) ? buf.toString('utf8') : '';
  if (!text || text.charAt(0) !== '{') return buf;
  let body;
  try { body = JSON.parse(text); } catch (_e) { return buf; }
  if (!body || typeof body !== 'object') return buf;
  const { rewriteNonSseEditFallback } = require('./edit_validation');
  const sessionId = payload ? sessionKey(payload) : '';
  const { body: next, count } = rewriteNonSseEditFallback(body, {
    checkFs: true,
    isUnread: (input) => {
      const fp = String((input && (input.file_path || input.path)) || '').trim();
      if (!fp || !fp.startsWith('/')) return true;
      if (!sessionId) return true;
      const cache = require('./session_read_cache');
      if (cache.hasRead(sessionId, fp)) return false;
      cache.recordRead(sessionId, fp, { source: 'edit_fallback_rewrite' });
      return true;
    },
  });
  if (!count) return buf;
  const out = JSON.stringify(next);
  return Buffer.isBuffer(buf) ? Buffer.from(out, 'utf8') : out;
}

function maybeRunStopFallback({ isAnthropic, payload, outBuf, lifecycleInactive, runInlineFallback }) {
  if (!isAnthropic || responseHasToolUse(outBuf) || responseHasErrorEvent(outBuf) || !lifecycleInactive('Stop')) return;
  try {
    const stopSession = payload ? sessionKey(payload) : 'unknown';
    const stdin = JSON.stringify({ session_id: stopSession, transcript_path: '' });
    runInlineFallback('Stop', stdin);
  } catch (err) {
    console.error('inline Stop threw:', err.message);
    try { require('./contexts/request_mutation').recordProxyFailure(require('./shared').PROJECT_ROOT, 'inline-stop-fallback', err); } catch (_e) { /* never let alerting throw */ }
  }
}

module.exports = {
  sendFinalResponse,
  maybeRunStopFallback,
  responseHasToolUse,
  responseHasErrorEvent,
  lastUserText,
  userWasDeny,
};
