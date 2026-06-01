'use strict';
// Transitional shell wrapper. post_hooks bundle late-stage diagnostics --
// no decisions; wrap unchanged.
//
// MUST RUN AFTER: holograph, work_checks
//
// Post-decision diagnostics; runs after the decision-emitting and snapshot
// policies so it has the final state to inspect.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('post_hooks');
