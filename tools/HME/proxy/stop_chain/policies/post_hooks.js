'use strict';
// Transitional shell wrapper. post_hooks bundle late-stage diagnostics —
// no decisions; wrap unchanged.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('post_hooks');
