'use strict';

function from(modulePath, name) {
  return (...args) => require(modulePath)[name](...args);
}

module.exports = {
  handleLegacySwapResponse: from('../../legacy_swap_response', 'handleLegacySwapResponse'),
  writeAnthropicStopSse: from('../../legacy_swap_response', 'writeAnthropicStopSse'),
  captureRateLimitTelemetry: from('../../hme_proxy_anthropic_response', 'captureRateLimitTelemetry'),
  emitContextTokenUsage: from('../../hme_proxy_anthropic_response', 'emitContextTokenUsage'),
  normalizeOmniContextWindowSse: from('../../hme_proxy_anthropic_response', 'normalizeOmniContextWindowSse'),
  retryOmniContextWindowExceeded: from('../../hme_proxy_anthropic_response', 'retryOmniContextWindowExceeded'),
  handleAnthropicResponseComplete: from('../../hme_proxy_anthropic_response', 'handleAnthropicResponseComplete'),
  translateRequestToOpenAI: from('../../zen_translator', 'translateRequestToOpenAI'),
  translateNonStreamResponseToAnthropic: from('../../zen_translator', 'translateNonStreamResponseToAnthropic'),
  sendFinalResponse: from('../../hme_proxy_response_send', 'sendFinalResponse'),
  maybeRunStopFallback: from('../../hme_proxy_response_send', 'maybeRunStopFallback'),
  responseHasToolUse: from('../../hme_proxy_response_send', 'responseHasToolUse'),
  responseHasErrorEvent: from('../../hme_proxy_response_send', 'responseHasErrorEvent'),
  lastUserText: from('../../hme_proxy_response_send', 'lastUserText'),
  userWasDeny: from('../../hme_proxy_response_send', 'userWasDeny'),
  retryBlankOmniRouteResponse: from('../../contexts/failure_policy/hme_proxy_codex', 'retryBlankOmniRouteResponse'),
  traceAnthropicResponse: from('../../hme_proxy_response_trace', 'traceAnthropicResponse'),
};
