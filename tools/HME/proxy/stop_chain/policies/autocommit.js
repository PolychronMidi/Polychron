'use strict';
// Transitional shell wrapper. autocommit is hundreds of lines of git logic
// in _autocommit.sh; porting deferred.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('autocommit', { timeoutMs: 60_000 });
