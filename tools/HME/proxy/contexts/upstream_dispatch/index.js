'use strict';

const upstream = require('../../upstream');
const omnirouteClient = require('../../omniroute_client');
const omnirouteProtocol = require('../../omniroute_protocol');
const modelRoutes = require('../../model_route_resolver');
const swapStore = require('../../swap_state_store');
const headers = require('../../hme_proxy_headers');
const services = require('../../service_registry');

function overdrive(name) {
  return (...args) => require('../../overdrive_route')[name](...args);
}

module.exports = {
  ...upstream,
  ...omnirouteProtocol,
  ...modelRoutes,
  ...headers,
  ...services,
  omnirouteClient,
  swapStore,
  effectiveMode: overdrive('effectiveMode'),
  roleFromPayload: overdrive('roleFromPayload'),
  roleTier: overdrive('roleTier'),
  roleKey: overdrive('roleKey'),
  modelTier: overdrive('modelTier'),
  claudeModelForOverdrive: overdrive('claudeModelForOverdrive'),
  findModelById: overdrive('findModelById'),
  rankedForTier: overdrive('rankedForTier'),
  buildMode1Chain: overdrive('buildMode1Chain'),
  chainSignature: overdrive('chainSignature'),
  selectedIndex: overdrive('selectedIndex'),
  isManualTopActive: overdrive('isManualTopActive'),
  upstreamModelId: overdrive('upstreamModelId'),
  modelRouteKey: overdrive('modelRouteKey'),
  applyOverdriveRoute: overdrive('applyOverdriveRoute'),
  messageTextForRoleDetection: overdrive('messageTextForRoleDetection'),
};
