'use strict';

function from(modulePath, name) {
  return (...args) => require(modulePath)[name](...args);
}

module.exports = {
  handleUpstreamFailureOrSuccess: from('./hme_proxy_upstream_failure', 'handleUpstreamFailureOrSuccess'),
  recordSuccessAndReset: from('./hme_proxy_upstream_failure', 'recordSuccessAndReset'),
  recordOmniRouteFailureAdvance: from('./hme_proxy_codex', 'recordOmniRouteFailureAdvance'),
  retryBlankOmniRouteResponse: from('./hme_proxy_codex', 'retryBlankOmniRouteResponse'),
  upstreamModelId: from('./hme_proxy_codex', 'upstreamModelId'),
  chainSignature: from('./hme_proxy_codex', 'chainSignature'),
  isManualTopActive: from('./hme_proxy_codex', 'isManualTopActive'),
  blankRetryDisabledReason: from('./hme_proxy_codex', 'blankRetryDisabledReason'),
  handleMidResponseError: from('./hme_proxy_connection_errors', 'handleMidResponseError'),
  handleConnectionError: from('./hme_proxy_connection_errors', 'handleConnectionError'),
  shouldRetryConnectionError: from('./hme_proxy_connection_errors', 'shouldRetryConnectionError'),
  routeHealthPath: from('./model_route_health', 'routeHealthPath'),
  loadModelRouteHealth: from('./model_route_health', 'loadModelRouteHealth'),
  routeQuarantineForced: from('./model_route_health', 'routeQuarantineForced'),
  quarantineReason: from('./model_route_health', 'quarantineReason'),
  routeSkipReason: from('./model_route_health', 'routeSkipReason'),
  markRouteCooldown: from('./model_route_health', 'markRouteCooldown'),
};
