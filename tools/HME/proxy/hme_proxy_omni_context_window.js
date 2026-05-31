'use strict';

const { emit, PROJECT_ROOT } = require('./shared');
const { markRouteCooldown } = require('./contexts/failure_policy/model_route_health');
const { submitCcShortcut } = require('./cc_control');

// Cooldown so a burst of over-window responses (e.g. both slots, retries)
// triggers at most one live-session compact per window instead of spamming
const _CC_COMPACT_COOLDOWN_MS = 30_000;
let _lastCcCompactMs = 0;

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

// On upstream context-window overflow we do NOT bail to a different chain
// model -- a smaller-window sibling fails identically and a weaker model
// degrades the turn. Instead we submit the local-session 'cc' shortcut
function _requestLiveCompact({ routeKey, projectRoot, log }) {
  const now = Date.now();
  if (now - _lastCcCompactMs < _CC_COMPACT_COOLDOWN_MS) {
    log(`[hme-proxy] context-window overflow on ${routeKey}; compact already requested ${(now - _lastCcCompactMs)}ms ago, skipping duplicate`);
    return false;
  }
  let delivered = false;
  try {
    delivered = submitCcShortcut(projectRoot, 'cc');
  } catch (err) {
    log(`[hme-proxy] context-window cc-shortcut submit failed: ${err.message}`);
    emit({ event: 'context_window_compact_requested', route: routeKey, delivered: false, error: err.message });
    return false;
  }
  if (delivered) _lastCcCompactMs = now;
  emit({ event: 'context_window_compact_requested', route: routeKey, delivered });
  log(`[hme-proxy] context-window overflow on ${routeKey}; cc shortcut ${delivered ? 'submitted to live session (/compact -> continue)' : 'unavailable (no PTY bridge attached)'}`);
  return delivered;
}

async function retryOmniContextWindowExceeded({ isOmniRouteSwap, status, headers, fullBody, payload, omniProvider, projectRoot = PROJECT_ROOT, log = console.error }) {
  if (!_isContextWindowExceededSse({ isOmniRouteSwap, status, outHeaders: headers, outBuf: fullBody })) return null;
  const routeKey = _omniRouteKeyFromModel(payload && payload.model, omniProvider);
  try {
    markRouteCooldown(routeKey, 'context_window_exceeded', { ttlMs: 300_000, projectRoot });
    emit({ event: 'model_route_quarantine', route: routeKey, reason: 'context_window_exceeded' });
  } catch (err) {
    log(`[hme-proxy] context-window route quarantine failed: ${err.message}`);
  }
  // Trigger the live-session compact instead of rerouting to another model.
  // Always return null: the caller normalizes this turn into a clean
  _requestLiveCompact({ routeKey, projectRoot, log });
  return null;
}

module.exports = {
  normalizeOmniContextWindowSse,
  retryOmniContextWindowExceeded,
};
