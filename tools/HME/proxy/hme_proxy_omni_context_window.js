'use strict';

const { emit, PROJECT_ROOT } = require('./shared');
const { markRouteCooldown } = require('./contexts/failure_policy/model_route_health');
const { submitCcCompactOnce, clearCcCompactInflight } = require('./cc_control');

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

// On upstream context-window overflow we do NOT bail to a different chain model
// (a smaller-window sibling fails identically and a weaker model degrades the
// turn). We trigger the local-session 'cc' shortcut (/compact then continue) so
function _requestLiveCompact({ routeKey, projectRoot, log }) {
  let result;
  try {
    result = submitCcCompactOnce(projectRoot);
  // silent-ok: proxy path logs or preserves raw response; caller keeps explicit status.
  } catch (err) {
    log(`[hme-proxy] context-window cc-shortcut submit failed: ${err.message}`);
    emit({ event: 'context_window_compact_requested', route: routeKey, delivered: false, error: err.message });
    return false;
  }
  emit({ event: 'context_window_compact_requested', route: routeKey, delivered: result.submitted, reason: result.reason });
  if (result.reason === 'inflight') {
    log(`[hme-proxy] context-window overflow on ${routeKey}; a compact cycle is already in flight, not re-submitting (prevents step reorder)`);
  } else if (result.submitted) {
    log(`[hme-proxy] context-window overflow on ${routeKey}; cc shortcut submitted to live session (/compact -> continue)`);
  } else {
    log(`[hme-proxy] context-window overflow on ${routeKey}; cc shortcut unavailable (no PTY bridge attached)`);
  }
  return result.submitted;
}

async function retryOmniContextWindowExceeded({ isOmniRouteSwap, status, headers, fullBody, payload, omniProvider, projectRoot = PROJECT_ROOT, log = console.error }) {
  if (!_isContextWindowExceededSse({ isOmniRouteSwap, status, outHeaders: headers, outBuf: fullBody })) {
    // A clean (non-over-window) interactive response means any prior compact
    // cycle has landed -- clear the single-flight guard so a later genuine
    if (isOmniRouteSwap && status >= 200 && status < 300) {
      try { clearCcCompactInflight(projectRoot); } catch (err) { log(`[hme-proxy] cc-compact inflight clear failed: ${err.message}`); }
    }
    return null;
  }
  const routeKey = _omniRouteKeyFromModel(payload && payload.model, omniProvider);
  try {
    markRouteCooldown(routeKey, 'context_window_exceeded', { ttlMs: 300_000, projectRoot });
    emit({ event: 'model_route_quarantine', route: routeKey, reason: 'context_window_exceeded' });
  // silent-ok: proxy path logs or preserves raw response; caller keeps explicit status.
  } catch (err) {
    log(`[hme-proxy] context-window route quarantine failed: ${err.message}`);
  }
  // Trigger the live-session compact (single-flight) instead of rerouting to
  // another model. Always return null: the caller normalizes this turn into a
  _requestLiveCompact({ routeKey, projectRoot, log });
  return null;
}

module.exports = {
  normalizeOmniContextWindowSse,
  retryOmniContextWindowExceeded,
};
