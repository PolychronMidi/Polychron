'use strict';
// Stop remains the only autocommit trigger for host adapters that do not pass
// through request middleware (notably OpenCode). The shell helper owns failure
// bookkeeping and always exits non-blocking for the rest of the Stop chain.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('autocommit');
