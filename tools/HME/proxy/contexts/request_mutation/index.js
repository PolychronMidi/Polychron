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
const {
  isSingleQuotaProbe,
  isTodoWriteOnlyProbe,
  isStructuredOutputsProbe,
  shouldBlockNoopSystemReminderTurn,
  blockQuotaProbe,
  blockTodoWriteOnlyProbe,
  blockStructuredOutputsProbe,
  blockNoopSystemReminderTurn,
} = require('../../prompt_spam_guard');

module.exports = {
  mutateClaudeRequest,
  applyExplicitOtpmCap,
  buildJurisdictionContext,
  scanMessages,
  middleware,
  isSingleQuotaProbe,
  isTodoWriteOnlyProbe,
  isStructuredOutputsProbe,
  shouldBlockNoopSystemReminderTurn,
  blockQuotaProbe,
  blockTodoWriteOnlyProbe,
  blockStructuredOutputsProbe,
  blockNoopSystemReminderTurn,
};
