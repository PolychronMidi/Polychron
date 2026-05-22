'use strict';

const { emit, PROJECT_ROOT } = require('./shared');
const hmeDispatcher = require('./hme_dispatcher');
const { traceAnthropicResponse } = require('./hme_proxy_response_trace');
const { sendFinalResponse, maybeRunStopFallback } = require('./hme_proxy_response_send');
const { handleUpstreamFailureOrSuccess } = require('./hme_proxy_upstream_failure');
const { runToolLoop: _runOmniToolLoop } = require('./omni_tool_loop');
const { omniProviderForConfigProvider } = require('./omniroute_protocol');
const { upstreamModelId } = require('./overdrive_route');
const { markRouteCooldown } = require('./model_route_health');
const swapStore = require('./swap_state_store');

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

function _num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function _extractUsageFromJson(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const usage = obj.usage && typeof obj.usage === 'object' ? obj.usage : {};
  return {
    input_tokens: _num(usage.input_tokens ?? usage.prompt_tokens),
    output_tokens: _num(usage.output_tokens ?? usage.completion_tokens),
  };
}

function _extractUsageFromBody(headers, body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  const ctype = String(headers && headers['content-type'] || '').toLowerCase();
  let input_tokens = null;
  let output_tokens = null;
  function take(obj) {
    const u = _extractUsageFromJson(obj);
    if (u.input_tokens != null) input_tokens = u.input_tokens;
    if (u.output_tokens != null) output_tokens = u.output_tokens;
    if (obj && obj.message && typeof obj.message === 'object') {
      const mu = _extractUsageFromJson(obj.message);
      if (mu.input_tokens != null) input_tokens = mu.input_tokens;
      if (mu.output_tokens != null) output_tokens = mu.output_tokens;
    }
  }
  if (ctype.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;
      try { take(JSON.parse(data)); } catch (_e) { /* ignore malformed event */ }
    }
  } else if (text.trimStart().startsWith('{')) {
    try { take(JSON.parse(text)); } catch (_e) { /* ignore malformed JSON */ }
  }
  return { input_tokens, output_tokens };
}

function _contextTokenUsageFields({ headers, rateLimitHeaders, status, payload, outBody, outBuf, route, model, thresholdBytes, estimatedTokensFn, getLastInputTokensRemaining, getLastInputTokensLimit }) {
  const bodyBytes = Buffer.byteLength(outBody || Buffer.alloc(0));
  const responseBytes = Buffer.byteLength(outBuf || Buffer.alloc(0));
  const estimate = typeof estimatedTokensFn === 'function' ? estimatedTokensFn(bodyBytes) : null;
  const providerHeaders = rateLimitHeaders || headers || {};
  const limitHeader = _num(providerHeaders['anthropic-ratelimit-input-tokens-limit']);
  const remainingHeader = _num(providerHeaders['anthropic-ratelimit-input-tokens-remaining']);
  const outboundRemainingHeader = _num((headers || {})['anthropic-ratelimit-input-tokens-remaining']);
  const limit = limitHeader ?? (typeof getLastInputTokensLimit === 'function' ? getLastInputTokensLimit() : null);
  const remaining = remainingHeader ?? (typeof getLastInputTokensRemaining === 'function' ? getLastInputTokensRemaining() : null);
  const usedFromRemaining = limitHeader != null && remainingHeader != null ? Math.max(0, limitHeader - remainingHeader) : null;
  const usage = _extractUsageFromBody(headers, outBuf);
  return {
    event: 'context_token_usage',
    route,
    model: model || payload && payload.model || '',
    status,
    request_bytes: bodyBytes,
    response_bytes: responseBytes,
    estimated_input_tokens: estimate,
    threshold_bytes: thresholdBytes || 0,
    header_input_tokens_limit: limitHeader,
    header_input_tokens_remaining: remainingHeader,
    header_input_tokens_used: usedFromRemaining,
    header_input_tokens_source: (limitHeader != null || remainingHeader != null) ? 'upstream' : 'none',
    context_signal_input_tokens_remaining: remainingHeader == null ? outboundRemainingHeader : null,
    cached_input_tokens_limit: limit,
    cached_input_tokens_remaining: remaining,
    usage_input_tokens: usage.input_tokens,
    usage_output_tokens: usage.output_tokens,
    estimated_vs_usage_delta: usage.input_tokens != null && estimate != null ? estimate - usage.input_tokens : null,
  };
}

function emitContextTokenUsage(args) {
  try { emit(_contextTokenUsageFields(args)); }
  catch (_e) { /* silent-ok: telemetry must not affect response path */ }
}

function _anthropicErrorSseBuffer(type, message) {
  const data = { type: 'error', error: { type, message } };
  return Buffer.from(`event: error\ndata: ${JSON.stringify(data)}\n\n`, 'utf8');
}

function _omniRouteKeyFromModel(model, fallbackProvider = '') {
  const m = String(model || '');
  if (m.includes('/')) return m;
  return `${fallbackProvider || 'omniroute'}/${m}`;
}

function _isContextWindowExceededSse({ isOmniRouteSwap, status, outHeaders, outBuf }) {
  if (!isOmniRouteSwap || status < 200 || status >= 300
      || !(outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream')) {
    return false;
  }
  const text = outBuf.toString('utf8');
  return !text.includes('event: message_start') && /input exceeds the context window/i.test(text);
}

function normalizeOmniContextWindowSse({ isOmniRouteSwap, status, outHeaders, outBuf, swapModel: _swapModel, anthropicTextSseBuffer: _anthropicTextSseBuffer, log = console.error }) {
  if (!_isContextWindowExceededSse({ isOmniRouteSwap, status, outHeaders, outBuf })) {
    return { outHeaders, outBuf };
  }
  const msg = 'Upstream context window exceeded: input exceeds the context window. Compact or start a fresh turn before retrying this transcript.';
  log(`[hme-proxy] OmniRoute context-window SSE preserved as Anthropic error event (${outBuf.length}B error body)`);
  const headers = {
    ...outHeaders,
    'content-type': 'text/event-stream; charset=utf-8',
    'x-hme-proxy-error': 'context_window_exceeded',
    'x-hme-context-window-exceeded': '1',
  };
  delete headers['content-length'];
  return { outHeaders: headers, outBuf: _anthropicErrorSseBuffer('context_window_exceeded', msg) };
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
  if (isOmniRouteSwap) injectContextHeader(headers, swapModel);

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

  if (status >= 200 && status < 300 && payload && payload.__shortcut_compact) {
    try {
      console.error('[shortcuts] compact response received, auto-submitting continue...');
      const respStr = fullBody.toString('utf8');
      let assistantContent;
      const ctype = (headers['content-type'] || '').toLowerCase();
      if (ctype.includes('text/event-stream')) {
        const text = [];
        for (const ev of respStr.split('\n\n')) {
          for (const line of ev.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const d = JSON.parse(line.slice(6));
                if (d && d.delta && d.delta.text) text.push(d.delta.text);
              } catch (_) {}
            }
          }
        }
        assistantContent = [{ type: 'text', text: text.join('') || '(compact completed)' }];
      } else if (respStr.trimStart().startsWith('{')) {
        try {
          const json = JSON.parse(respStr);
          assistantContent = json.content || [{ type: 'text', text: respStr }];
        } catch (_) {
          assistantContent = [{ type: 'text', text: respStr }];
        }
      } else {
        assistantContent = [{ type: 'text', text: respStr }];
      }

      payload.messages.push({ role: 'assistant', content: assistantContent });
      payload.messages.push({ role: 'user', content: [{ type: 'text', text: 'continue' }] });
      delete payload.__shortcut_compact;

      const continueBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const continueOpts = { ...upstreamOpts, headers: { ...upstreamHeaders, 'content-length': String(continueBody.length) } };
      const retry = await new Promise((res, rej) => {
        const req = transport.request(continueOpts, (r) => {
          const cs = [];
          r.on('data', (c) => cs.push(c));
          r.on('end', () => res({ status: r.statusCode || 502, headers: { ...r.headers }, body: Buffer.concat(cs) }));
          r.on('error', rej);
        });
        req.on('error', rej);
        req.write(continueBody);
        req.end();
      });

      status = retry.status;
      headers = retry.headers;
      fullBody = retry.body;
      console.error(`[shortcuts] compact + continue result: ${status}`);
    } catch (e) {
      console.error(`[shortcuts] compact-continue failed: ${e.message}`);
    }
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
    estimatedTokensFn: estimatedContextTokens,
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
  handleAnthropicResponseComplete,
};
