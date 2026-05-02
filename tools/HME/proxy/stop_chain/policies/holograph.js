'use strict';
// Transitional shell wrapper. holograph is a diagnostic snapshot — emits
// no decisions; wrap unchanged.
//
// MUST RUN AFTER: work_checks, anti_patterns, detectors
// MUST RUN BEFORE: post_hooks
//
// The holograph captures closing state across audits; running after the
// decision-emitting policies means the snapshot reflects the final verdict.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('holograph');
