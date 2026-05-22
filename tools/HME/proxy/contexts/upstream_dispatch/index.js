'use strict';

const { createClaudeHandler } = require('../../hme_proxy_claude');
const {
  omniProviderForConfigProvider,
  omniTargetFormat,
} = require('../../omniroute_protocol');
const {
  upstreamModelId,
  isManualTopActive,
} = require('../../overdrive_route');
const swapStore = require('../../swap_state_store');
const { servicePort } = require('../../service_registry');
const {
  recordUpstreamSuccess,
  recordUpstreamFailure,
  refreshOauthToken,
  isPassthroughMode,
} = require('../../upstream');
const omniroute = require('../../omniroute_client');
const resolver = require('../../model_route_resolver');
const { routeDecision } = resolver;

module.exports = {
  createClaudeHandler,
  omniProviderForConfigProvider,
  omniTargetFormat,
  upstreamModelId,
  isManualTopActive,
  swapStore,
  servicePort,
  recordUpstreamSuccess,
  recordUpstreamFailure,
  refreshOauthToken,
  isPassthroughMode,
  omniroute,
  resolver,
  routeDecision,
};
