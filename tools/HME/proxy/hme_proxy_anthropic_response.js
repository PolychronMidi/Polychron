'use strict';

function hmeDispatcher() {
  return require('./contexts/lifecycle_bridge').hmeDispatcher;
}
const { traceAnthropicResponse } = require('./hme_proxy_response_trace');
const { sendFinalResponse, maybeRunStopFallback } = require('./hme_proxy_response_send');
const { emit } = require('./shared');
const {
  handleUpstreamFailureOrSuccess,
} = require('./contexts/failure_policy/hme_proxy_upstream_failure');
const { runToolLoop: _runOmniToolLoop } = require('./omni_tool_loop');
const {
  captureRateLimitTelemetry,
  emitContextTokenUsage,
  _contextTokenUsageFields,
  _extractUsageFromBody,
} = require('./hme_proxy_anthropic_usage');
const {
  normalizeOmniContextWindowSse,
  retryOmniContextWindowExceeded,
} = require('./hme_proxy_omni_context_window');
const { semanticTokenEstimate } = require('./context_token_estimate');

function _assistantContentFromResponse(fullBody, headers) {
  const respStr = fullBody.toString('utf8');
  const ctype = String(headers['content-type'] || '').toLowerCase();
  if (ctype.includes('text/event-stream')) {
    const parts = [];
    for (const line of respStr.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(line.slice(6));
        if (d && d.delta && typeof d.delta.text === 'string') parts.push(d.delta.text);
      } catch (_) { /* non-JSON SSE keepalive/comment line */ }
    }
    return [{ type: 'text', text: parts.join('') || '(no text returned)' }];
  }
  if (respStr.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(respStr);
      if (Array.isArray(json.content)) return json.content;
    } catch (_) { /* fall through to raw text */ }
  }
  return [{ type: 'text', text: respStr }];
}

function _textOfContent(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
}

// Pull the REAL token usage out of an upstream response. The merged two-step
// response MUST report this (not zeros) or Claude Code reads input_tokens=0 and
function _usageFromResponse(fullBody, headers) {
  const respStr = fullBody.toString('utf8');
  const ctype = String(headers['content-type'] || '').toLowerCase();
  if (ctype.includes('text/event-stream')) {
    let usage = null;
    for (const line of respStr.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(line.slice(6));
        if (d && d.type === 'message_start' && d.message && d.message.usage) usage = { ...d.message.usage };
        if (d && d.type === 'message_delta' && d.usage) usage = { ...(usage || {}), ...d.usage };
      } catch (_) { /* skip */ }
    }
    return usage;
  }
  if (respStr.trimStart().startsWith('{')) {
    try { const j = JSON.parse(respStr); if (j && j.usage) return j.usage; } catch (_) { /* ignore */ }
  }
  return null;
}

function _mergedSseBuffer(model, text, usage) {
  const id = `proxy_${Date.now()}`;
  const u = usage || { input_tokens: 0, output_tokens: 0 };
  const chunks = [
    ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: u } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: u.output_tokens || 0 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return Buffer.from(chunks.map(([ev, data]) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join(''), 'utf8');
}

// Two-step shortcut round-trip: a request flagged with a non-enumerable
// `__hme_followup` (set by 00a_shortcuts_rewriter) sends its first message,
async function _maybeRunTwoStepFollowup({ status, headers, fullBody, payload, transport, upstreamOpts, upstreamHeaders }) {
  if (!(status >= 200 && status < 300) || !payload || !payload.__hme_followup || !Array.isArray(payload.messages)) return null;
  const followupText = payload.__hme_followup;
  delete payload.__hme_followup;
  try {
    const firstContent = _assistantContentFromResponse(fullBody, headers);
    payload.messages.push({ role: 'assistant', content: firstContent });
    payload.messages.push({ role: 'user', content: [{ type: 'text', text: followupText }] });
    const followBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const followOpts = { ...upstreamOpts, headers: { ...upstreamHeaders, 'content-length': String(followBody.length) } };
    const retry = await new Promise((resolve, reject) => {
      const req = transport.request(followOpts, (r) => {
        const cs = [];
        r.on('data', (c) => cs.push(c));
        r.on('end', () => resolve({ status: r.statusCode || 502, headers: { ...r.headers }, body: Buffer.concat(cs) }));
        r.on('error', reject);
      });
      req.on('error', reject);
      req.write(followBody);
      req.end();
    });
    emit({ event: 'shortcut_followup_submitted', followup: followupText, status: retry.status });
    if (!(retry.status >= 200 && retry.status < 300)) return { status: retry.status, headers: retry.headers, fullBody: retry.body };
    const merged = [_textOfContent(firstContent), _textOfContent(_assistantContentFromResponse(retry.body, retry.headers))].filter(Boolean).join('\n\n');
    const usage = _usageFromResponse(retry.body, retry.headers) || _usageFromResponse(fullBody, headers);
    // Keep the already-normalized context/ratelimit headers from the FIRST
    // response (injectContextHeader ran on them); only override content framing.
    const outHeaders = { ...headers };
    delete outHeaders['content-length'];
    const streaming = payload.stream === true || String(headers['content-type'] || '').includes('text/event-stream');
    if (streaming) {
      outHeaders['content-type'] = 'text/event-stream; charset=utf-8';
      return { status: 200, headers: outHeaders, fullBody: _mergedSseBuffer(payload.model || 'hme-proxy', merged, usage) };
    }
    const jsonBody = Buffer.from(JSON.stringify({
      id: `proxy_${Date.now()}`, type: 'message', role: 'assistant', model: payload.model || 'hme-proxy',
      content: [{ type: 'text', text: merged }], stop_reason: 'end_turn', stop_sequence: null,
      usage: usage || { input_tokens: 0, output_tokens: 0 },
    }), 'utf8');
    outHeaders['content-type'] = 'application/json';
    outHeaders['content-length'] = String(jsonBody.length);
    return { status: 200, headers: outHeaders, fullBody: jsonBody };
  } catch (e) {
    console.error(`[shortcuts] two-step followup failed: ${e.message}`);
    return null;
  }
}

async function handleAnthropicResponseComplete({
  chunks,
  upstreamRes,
  clientRes,
  clientReq,
  payload,
  headers,
  bodyBuf,
  outBody,
  upstream,
  upstreamPath,
  upstreamHeaders,
  upstreamOpts,
  transport,
  isAnthropic,
  passthrough,
  isOmniRouteSwap,
  swapChain,
  odMode,
  omniProvider,
  swapModel,
  isInteractivePath,
  sessionForTelemetry,
  effectiveCompactThreshold,
  getConsecutive429s,
  setConsecutive429s,
  incConsecutive429s,
  getLastInputTokensRemaining,
  setLastInputTokensRemaining,
  getLastInputTokensLimit,
  setLastInputTokensLimit,
  estimatedContextTokens,
  omniContextThresholdBytes,
  injectContextHeader,
  anthropicTextSseBuffer,
  lifecycleInactive,
  runInlineFallback,
  skipStopFallback = false,
}) {
  let fullBody = Buffer.concat(chunks);
  let status = upstreamRes.statusCode || 502;
  headers = { ...headers };
  const upstreamRateLimitHeaders = { ...headers };

  captureRateLimitTelemetry({ headers: upstreamRateLimitHeaders, status, setLastInputTokensRemaining, setLastInputTokensLimit });
  // Always normalize rate-limit headers using Claude statusline ground truth,
  // not just on omni-swap. Forwarding raw upstream Anthropic per-minute quota
  injectContextHeader(headers, swapModel);

  const failureResult = await handleUpstreamFailureOrSuccess({
    status,
    headers,
    fullBody,
    outBody,
    clientReq,
    upstreamHeaders,
    upstreamOpts,
    transport,
    payload,
    isAnthropic,
    passthrough,
    isOmniRouteSwap,
    swapChain,
    odMode,
    omniProvider,
    swapModel,
    isInteractivePath,
    sessionForTelemetry,
    effectiveCompactThreshold,
    getConsecutive429s,
    setConsecutive429s,
    incConsecutive429s,
  });
  status = failureResult.status;
  headers = failureResult.headers;
  fullBody = failureResult.fullBody;

  const contextRetry = await retryOmniContextWindowExceeded({
    isOmniRouteSwap,
    status,
    headers,
    fullBody,
    payload,
    swapChain,
    omniProvider,
    swapModel,
    transport,
    upstreamOpts,
    upstreamHeaders,
  });
  if (contextRetry) {
    status = contextRetry.status;
    headers = contextRetry.headers;
    fullBody = contextRetry.fullBody;
  }

  const twoStep = await _maybeRunTwoStepFollowup({ status, headers, fullBody, payload, transport, upstreamOpts, upstreamHeaders });
  if (twoStep) {
    status = twoStep.status;
    headers = twoStep.headers;
    fullBody = twoStep.fullBody;
  }

  if (isOmniRouteSwap && status >= 200 && status < 300 && payload && Array.isArray(payload.messages) && process.env.HME_OMNI_TOOL_LOOP === '1') {
    try {
      const loopResult = await _runOmniToolLoop({
        fullBody, headers, payload, transport, upstreamOpts, upstreamHeaders,
        projectRoot: require('./shared').PROJECT_ROOT,
      });
      if (loopResult) {
        status = loopResult.status;
        headers = loopResult.headers;
        fullBody = loopResult.fullBody;
        const loopCtype = (loopResult.headers['content-type'] || '').toLowerCase();
        if (payload.stream && !loopCtype.includes('text/event-stream')) {
          const { _anthropicTextSseBuffer } = require('./hme_proxy_core');
          let text = '';
          try {
            const json = JSON.parse(fullBody.toString('utf8'));
            text = (json && Array.isArray(json.content))
              ? json.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('')
              : '';
          } catch (_) { /* non-JSON body, use raw */ }
          text = text || fullBody.toString('utf8');
          if (!text) text = '(omni model returned empty content)';
          fullBody = _anthropicTextSseBuffer(swapModel || 'omni', text);
          headers = { ...headers, 'content-type': 'text/event-stream; charset=utf-8' };
        }
      }
    } catch (e) {
      console.error(`[omni-tool-loop] error: ${e.message}`);
    }
  }

  let final = null;
  if (status >= 200 && status < 300 && payload) {
    try {
      final = await hmeDispatcher().maybeHandleHme(
        fullBody, headers, status, payload,
        { host: upstream.host, port: upstream.port, tls: upstream.tls, path: upstreamPath, method: 'POST', headers: upstreamHeaders },
        (headers['content-type'] || '').toLowerCase().includes('text/event-stream'),
      );
    } catch (err) {
      console.error('HME continuation failed:', err.message);
    }
  }

  let outStatus = status;
  let outHeaders = headers;
  let outBuf = fullBody;
  ({ outHeaders, outBuf } = normalizeOmniContextWindowSse({
    isOmniRouteSwap,
    status,
    outHeaders,
    outBuf,
    swapModel,
    anthropicTextSseBuffer,
  }));

  if (final) {
    outStatus = final.finalStatus;
    outHeaders = { ...final.finalHeaders };
    outBuf = final.finalBody;
    emit({ event: 'hme_continuation_complete', loops: final.loops, bytes: outBuf.length });
    delete outHeaders['content-length'];
  }

  const traced = await traceAnthropicResponse({
    isAnthropic,
    outStatus,
    outHeaders,
    outBuf,
    clientReq,
    upstreamHeaders,
    bodyBuf,
    outBody,
    payload,
    final,
    passthrough,
    isOmniRouteSwap,
    swapChain,
    isInteractivePath,
    getConsecutive429s,
    getLastInputTokensRemaining,
    getLastInputTokensLimit,
  });
  outStatus = traced.outStatus;
  outHeaders = traced.outHeaders;
  outBuf = traced.outBuf;

  emitContextTokenUsage({
    headers: outHeaders,
    rateLimitHeaders: upstreamRateLimitHeaders,
    status: outStatus,
    payload,
    outBody,
    outBuf,
    route: isOmniRouteSwap ? 'omni-context' : (passthrough ? 'passthrough' : 'direct'),
    model: isOmniRouteSwap ? swapModel : payload && payload.model,
    thresholdBytes: isOmniRouteSwap && typeof omniContextThresholdBytes === 'function' ? omniContextThresholdBytes(String(swapModel || '')) : (typeof effectiveCompactThreshold === 'function' ? effectiveCompactThreshold(payload) : 0),
    estimatedTokensFn: () => semanticTokenEstimate(payload, process.env),
    getLastInputTokensRemaining,
    getLastInputTokensLimit,
  });

  sendFinalResponse({ clientRes, payload, final, outStatus, outHeaders, outBuf });
  if (!skipStopFallback) {
    maybeRunStopFallback({ isAnthropic, payload, outBuf, lifecycleInactive, runInlineFallback });
  }
}

module.exports = {
  captureRateLimitTelemetry,
  emitContextTokenUsage,
  _contextTokenUsageFields,
  _extractUsageFromBody,
  normalizeOmniContextWindowSse,
  retryOmniContextWindowExceeded,
  handleAnthropicResponseComplete,
  _assistantContentFromResponse,
  _maybeRunTwoStepFollowup,
};
