'use strict';
// Transitional shell wrapper. holograph is a diagnostic snapshot — emits
// no decisions; wrap unchanged.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('holograph');
