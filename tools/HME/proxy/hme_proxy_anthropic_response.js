'use strict';

const { emit } = require('./shared');
const hmeDispatcher = require('./hme_dispatcher');
const { traceAnthropicResponse } = require('./hme_proxy_response_trace');
const { sendFinalResponse, maybeRunStopFallback } = require('./hme_proxy_response_send');
const { handleUpstreamFailureOrSuccess } = require('./hme_proxy_upstream_failure');

function captureRateLimitTelemetry({ headers, status, setLastInputTokensRemaining, setLastInputTokensLimit, log = console.error }) {
  const hdrTokRemaining = headers['anthropic-ratelimit-input-tokens-remaining'];
  const hdrTokLimit = headers['anthropic-ratelimit-input-tokens-limit'];
  const hdrTokReset = headers['anthropic-ratelimit-input-tokens-reset'];
  if (hdrTokRemaining != null) {
    const n = parseInt(hdrTokRemaining, 10);
    if (Number.isFinite(n) && n >= 0) setLastInputTokensRemaining(n);
  }
  if (hdrTokLimit != null) {
    const n = parseInt(hdrTokLimit, 10);
    if (Number.isFinite(n) && n > 0) setLastInputTokensLimit(n);
  }
  if (status >= 400 && status < 500 && (hdrTokLimit || hdrTokRemaining || hdrTokReset || headers['retry-after'])) {
    log(`rate-limit headers: limit=${hdrTokLimit||'?'} remaining=${hdrTokRemaining||'?'} reset=${hdrTokReset||'?'} retry-after=${headers['retry-after']||'?'}`);
  }
}

function normalizeOmniContextWindowSse({ isOmniRouteSwap, status, outHeaders, outBuf, swapModel, anthropicTextSseBuffer, log = console.error }) {
  if (!isOmniRouteSwap || status < 200 || status >= 300
      || !(outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream')) {
    return { outHeaders, outBuf };
  }
  const text = outBuf.toString('utf8');
  if (text.includes('event: message_start') || !/input exceeds the context window/i.test(text)) {
    return { outHeaders, outBuf };
  }
  const msg = 'Context window exceeded upstream before Claude Code could compact. Please send /compact or start a fresh turn; hme-proxy will preflight-shrink future near-limit OmniRoute requests.';
  log(`[hme-proxy] OmniRoute context-window SSE normalized to Anthropic text event (${outBuf.length}B error body)`);
  const headers = { ...outHeaders, 'content-type': 'text/event-stream; charset=utf-8' };
  delete headers['content-length'];
  return { outHeaders: headers, outBuf: anthropicTextSseBuffer(swapModel, msg) };
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
  injectContextHeader,
  anthropicTextSseBuffer,
  lifecycleInactive,
  runInlineFallback,
}) {
  let fullBody = Buffer.concat(chunks);
  let status = upstreamRes.statusCode || 502;
  headers = { ...headers };

  if (isOmniRouteSwap) injectContextHeader(headers, swapModel);
  captureRateLimitTelemetry({ headers, status, setLastInputTokensRemaining, setLastInputTokensLimit });

  const failureResult = await handleUpstreamFailureOrSuccess({
    status,
    headers,
    fullBody,
    outBody,
    clientReq: null,
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

  let final = null;
  if (status >= 200 && status < 300 && payload) {
    try {
      final = await hmeDispatcher.maybeHandleHme(
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
    clientReq: null,
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

  sendFinalResponse({ clientRes, payload, final, outStatus, outHeaders, outBuf });
  maybeRunStopFallback({ isAnthropic, payload, outBuf, lifecycleInactive, runInlineFallback });
}

module.exports = {
  captureRateLimitTelemetry,
  normalizeOmniContextWindowSse,
  handleAnthropicResponseComplete,
};
