'use strict';

const { classifyFailure, policyFor, actionsFor, POLICY_TABLE } = require('./omni_failure_policy');
const { handleUpstreamFailureOrSuccess, recordSuccessAndReset } = require('./hme_proxy_upstream_failure');
const { recordOmniRouteFailureAdvance, retryBlankOmniRouteResponse, blankRetryDisabledReason } = require('./hme_proxy_codex');
const { detectUpstreamFailure, alertCooldownActive } = require('./failure_classification');
const { handleMidResponseError, handleConnectionError } = require('./hme_proxy_connection_errors');
const { markRouteCooldown, loadModelRouteHealth, routeSkipReason } = require('./model_route_health');

module.exports = {
  classifyFailure,
  policyFor,
  actionsFor,
  POLICY_TABLE,
  handleUpstreamFailureOrSuccess,
  recordSuccessAndReset,
  recordOmniRouteFailureAdvance,
  retryBlankOmniRouteResponse,
  blankRetryDisabledReason,
  detectUpstreamFailure,
  alertCooldownActive,
  handleMidResponseError,
  handleConnectionError,
  markRouteCooldown,
  loadModelRouteHealth,
  routeSkipReason,
};
