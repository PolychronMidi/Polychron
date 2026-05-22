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
} = require('../../upstream');
const omniroute = require('../../omniroute_client');

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
  omniroute,
};
