'use strict';

const { emit } = require('./shared');

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

module.exports = {
  captureRateLimitTelemetry,
  emitContextTokenUsage,
  _contextTokenUsageFields,
  _extractUsageFromBody,
};
