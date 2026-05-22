'use strict';

// Bounded-context façade per doc/PROXY_CONTEXTS.md.
// Transforms the inbound client request before dispatch.

const {
  mutateClaudeRequest,
  applyExplicitOtpmCap,
} = require('../../hme_proxy_request_mutation');

module.exports = {
  mutateClaudeRequest,
  applyExplicitOtpmCap,
};
