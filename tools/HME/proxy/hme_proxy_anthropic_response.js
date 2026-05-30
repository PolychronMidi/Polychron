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
