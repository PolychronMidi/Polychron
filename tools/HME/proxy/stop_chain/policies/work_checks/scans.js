'use strict';

const {
  isBareCompletionMarker,
  isBroadCompletionPrompt,
  isNothingMissedResponse,
  scanIncompleteCompletionClaims,
  scanSpeculation,
} = require('./checks/completion');
const {
  scanNextActionDebt,
  scanWorkDebtAdmission,
} = require('./checks/task_debt');

module.exports = {
  isNothingMissedResponse,
  isBareCompletionMarker,
  scanSpeculation,
  isBroadCompletionPrompt,
  scanIncompleteCompletionClaims,
  scanNextActionDebt,
  scanWorkDebtAdmission,
};
