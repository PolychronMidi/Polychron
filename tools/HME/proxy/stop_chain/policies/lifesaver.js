'use strict';
// Transitional shell wrapper. lifesaver tracks new entries in
// log/hme-errors.log via a turnstart/watermark counter — the bash
// implementation handles edge cases (state-file wipe, watermark lag) that
// would all need re-derivation in JS. Wrap for now.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('lifesaver');
