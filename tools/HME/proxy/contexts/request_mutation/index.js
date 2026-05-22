'use strict';

// Bounded-context façade per doc/PROXY_CONTEXTS.md.
// Transforms the inbound client request before dispatch.

const {
  mutateClaudeRequest,
  applyExplicitOtpmCap,
} = require('../../hme_proxy_request_mutation');
const { buildJurisdictionContext } = require('../../context');
const { scanMessages } = require('../../messages');
const middleware = require('../../middleware');

module.exports = {
  mutateClaudeRequest,
  applyExplicitOtpmCap,
  buildJurisdictionContext,
  scanMessages,
  middleware,
};
