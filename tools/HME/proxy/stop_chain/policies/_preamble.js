'use strict';
// Transitional shell wrapper for the legacy _preamble.sh stage. Runs the
// context_meter Python script and inherits any other prep work the legacy
// script does. Pure-JS conversion is out of scope for this pass.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('_preamble');
