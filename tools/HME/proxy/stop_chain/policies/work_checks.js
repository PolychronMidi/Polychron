'use strict';

const { buildWorkCheckContext, REASONS } = require('./work_checks/context');
const {
  missingTranscriptCheck,
  missingUserPromptCheck,
  noisePromptCheck,
  startupGraceCheck,
  isStartupGraceTurn,
} = require('./work_checks/checks/early_exit');
const { detectorVerdictCheck } = require('./work_checks/checks/detector_verdict');
const {
  nextActionDebtCheck,
  parentTaskDebtCheck,
  scanNextActionDebt,
  scanWorkDebtAdmission,
  unfinishedTaskDebtCheck,
  workDebtAdmissionCheck,
} = require('./work_checks/checks/task_debt');
const {
  advanceCompletenessCounterCheck,
  autoCompletenessCheck,
  bareCompletionMarkerCheck,
  broadCompletionDebtCheck,
  completionBudgetCheck,
  isBareCompletionMarker,
  isBroadCompletionPrompt,
  isNothingMissedResponse,
  roundTwoNothingMissedCheck,
  scanIncompleteCompletionClaims,
  scanSpeculation,
  speculationDebtCheck,
} = require('./work_checks/checks/completion');
const { assistantToolUsesSinceLastUserPrompt } = require('./work_checks/transcript');

const WORK_CHECKS = Object.freeze([
  missingUserPromptCheck,
  startupGraceCheck,
  noisePromptCheck,
  detectorVerdictCheck,
  missingTranscriptCheck,
  unfinishedTaskDebtCheck,
  nextActionDebtCheck,
  workDebtAdmissionCheck,
  parentTaskDebtCheck,
  completionBudgetCheck,
  roundTwoNothingMissedCheck,
  bareCompletionMarkerCheck,
  advanceCompletenessCounterCheck,
  broadCompletionDebtCheck,
  speculationDebtCheck,
  autoCompletenessCheck,
]);

function evaluateWorkChecks(ctx) {
  const state = buildWorkCheckContext(ctx);
  for (const check of WORK_CHECKS) {
    const result = check.evaluate(state);
    if (result) return result;
  }
  return null;
}

module.exports = {
  name: 'work_checks',
  async run(ctx) {
    return evaluateWorkChecks(ctx) || ctx.allow();
  },
  evaluateWorkChecks,
  buildWorkCheckContext,
  _testables: {
    REASONS,
    WORK_CHECKS,
    assistantToolUsesSinceLastUserPrompt,
    buildWorkCheckContext,
    evaluateWorkChecks,
    isBareCompletionMarker,
    isBroadCompletionPrompt,
    isNothingMissedResponse,
    isStartupGraceTurn,
    scanIncompleteCompletionClaims,
    scanNextActionDebt,
    scanSpeculation,
    scanWorkDebtAdmission,
  },
};
