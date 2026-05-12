'use strict';
// Upstream failure classification + alert dedup (extracted from hme_proxy.js).
//   _tryParseJson: defensive parse for truncated/html/non-JSON bodies.
//   detectUpstreamFailure: -> {type,message,requestId,retryAfter?}; covers
//     HTTP 429 (rate vs overloaded), generic 4xx/5xx, SSE event:error in 200.
//   alertCooldownActive: 60s gate per (type,path_label) to dedup bursts
//     (escape hatch still trips on FIRST failure).

// Mirrors the original semantics from hme_proxy.js verbatim: requires
// the trimmed body to start with '{' or '[' before attempting parse,
// and logs the contextDesc + first 120 chars on parse failure.
function _tryParseJson(buf, contextDesc) {
  const text = buf.toString('utf8');
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`_tryParseJson(${contextDesc}): malformed JSON body: ${err.message} -- first 120 chars: ${trimmed.slice(0, 120)}`);
    return null;
  }
}

function detectUpstreamFailure(status, headers, fullBody) {
  if (status === 429) {
    const retryAfter = headers['retry-after'] || '?';
    const parsed = _tryParseJson(fullBody, 'upstream-429');
    // Anthropic returns BOTH rate_limit_error (user quota exhausted) and
    // overloaded_error (server capacity) under HTTP 429. Use the parsed
    // body's `error.type` to distinguish them; only fall back to a
    // generic label when the body lacks one. Mis-labelling matters
    // because the appropriate response differs: rate_limit_error means
    // wait/shrink, overloaded_error means retry-with-backoff.
    const realType = (parsed && parsed.error && parsed.error.type) || 'rate_limit_error';
    const msg = (parsed && parsed.error && parsed.error.message)
      ? parsed.error.message
      : `${realType} (retry-after=${retryAfter}s)`;
    return {
      type: realType,
      message: msg,
      requestId: parsed && parsed.request_id,
      retryAfter,
    };
  }
  if (status >= 400 && status < 600) {
    const parsed = _tryParseJson(fullBody, `upstream-${status}`);
    if (parsed && parsed.error) {
      return {
        type: parsed.error.type || `http_${status}`,
        message: parsed.error.message,
        requestId: parsed.request_id,
      };
    }
    return { type: `http_${status}`, message: fullBody.toString('utf8').slice(0, 500) };
  }
  // SSE error event scan (status 200 + event:error)
  const ct = (headers['content-type'] || '').toLowerCase();
  if (ct.includes('text/event-stream') && fullBody.length > 0) {
    const text = fullBody.toString('utf8');
    const idx = text.indexOf('event: error');
    if (idx >= 0) {
      const dataMatch = text.slice(idx).match(/^data:\s*(\{.*?\})\s*$/m);
      const parsed = dataMatch ? _tryParseJson(Buffer.from(dataMatch[1]), 'sse-error-event') : null;
      if (parsed) {
        const e = parsed.error || parsed;
        return {
          type: e.type || 'sse_error',
          message: e.message,
          requestId: parsed.request_id,
        };
      }
      return { type: 'sse_error', message: 'sse error event with unparseable data' };
    }
  }
  return null;
}

const _lastAlertAt = new Map(); // key = `${type}|${pathLabel}` -> ms
const _ALERT_COOLDOWN_MS = 60_000;
function alertCooldownActive(type, pathLabel) {
  const key = `${type}|${pathLabel}`;
  const now = Date.now();
  const last = _lastAlertAt.get(key) || 0;
  if (now - last < _ALERT_COOLDOWN_MS) return true;
  _lastAlertAt.set(key, now);
  return false;
}

module.exports = {
  _tryParseJson,
  detectUpstreamFailure,
  alertCooldownActive,
};
