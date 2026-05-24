'use strict';

const { emit, PROJECT_ROOT } = require('./shared');
const { markRouteCooldown } = require('./contexts/failure_policy');
const {
  omniProviderForConfigProvider,
  swapStore,
  upstreamModelId,
} = require('./contexts/upstream_dispatch');

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

function _cloneWithTailMessages(payload, keep = 80) {
  const retryPayload = JSON.parse(JSON.stringify(payload || {}));
  if (Array.isArray(retryPayload.messages) && retryPayload.messages.length > keep) {
    retryPayload.messages = retryPayload.messages.slice(-keep);
  }
  retryPayload.stream = false;
  if (typeof retryPayload.max_tokens !== 'number' || retryPayload.max_tokens > 2048) retryPayload.max_tokens = 2048;
  delete retryPayload.thinking;
  return retryPayload;
}

function _retryHttpMessage({ transport, upstreamOpts, upstreamHeaders, payload }) {
  const retryBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const retryOpts = { ...upstreamOpts, headers: { ...upstreamHeaders, 'content-length': String(retryBody.length) } };
  return new Promise((resolve, reject) => {
    const req = transport.request(retryOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 502, headers: { ...res.headers }, fullBody: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(retryBody);
    req.end();
  });
}

async function retryOmniContextWindowExceeded({ isOmniRouteSwap, status, headers, fullBody, payload, swapChain, omniProvider, swapModel: _swapModel, transport, upstreamOpts, upstreamHeaders, projectRoot = PROJECT_ROOT, log = console.error }) {
  if (!_isContextWindowExceededSse({ isOmniRouteSwap, status, outHeaders: headers, outBuf: fullBody })) return null;
  const routeKey = _omniRouteKeyFromModel(payload && payload.model, omniProvider);
  try {
    markRouteCooldown(routeKey, 'context_window_exceeded', { ttlMs: 300_000, projectRoot });
    emit({ event: 'model_route_quarantine', route: routeKey, reason: 'context_window_exceeded' });
  } catch (err) {
    log(`[hme-proxy] context-window route quarantine failed: ${err.message}`);
  }
  if (!Array.isArray(swapChain) || swapChain.length <= 1 || !payload) return null;
  const startIdx = swapStore.peek(projectRoot).idx || 0;
  for (let ri = 1; ri < swapChain.length; ri++) {
    const retryIdx = (startIdx + ri) % swapChain.length;
    const candidate = swapChain[retryIdx];
    const provider = omniProviderForConfigProvider(candidate.provider || '');
    const model = upstreamModelId(candidate);
    const retryPayload = _cloneWithTailMessages(payload, 80);
    retryPayload.model = `${provider}/${model}`;
    log(`[hme-proxy] context-window retry ${ri}/${swapChain.length - 1}: ${retryPayload.model} tail_msgs=${Array.isArray(retryPayload.messages) ? retryPayload.messages.length : 0}`);
    try {
      const retry = await _retryHttpMessage({ transport, upstreamOpts, upstreamHeaders, payload: retryPayload });
      if (retry.status >= 200 && retry.status < 300
          && !_isContextWindowExceededSse({ isOmniRouteSwap: true, status: retry.status, outHeaders: retry.headers, outBuf: retry.fullBody })) {
        swapStore.recordSuccess(swapChain, retryIdx, projectRoot);
        emit({ event: 'context_window_retry', outcome: 'success', route: retryPayload.model, prior_route: routeKey });
        return retry;
      }
      if (_isContextWindowExceededSse({ isOmniRouteSwap: true, status: retry.status, outHeaders: retry.headers, outBuf: retry.fullBody })) {
        try { markRouteCooldown(retryPayload.model, 'context_window_exceeded', { ttlMs: 300_000, projectRoot }); } catch (_e) { /* best effort */ }
      }
      emit({ event: 'context_window_retry', outcome: 'failed', status: retry.status, route: retryPayload.model, prior_route: routeKey });
    } catch (err) {
      log(`[hme-proxy] context-window retry failed: ${err.message}`);
      emit({ event: 'context_window_retry', outcome: 'error', route: retryPayload.model, message: err.message });
    }
  }
  return null;
}

module.exports = {
  normalizeOmniContextWindowSse,
  retryOmniContextWindowExceeded,
};
