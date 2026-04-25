'use strict';
// Transitional shell wrapper. detectors.sh runs scripts/detectors/run_all.py
// and writes verdicts to tmp/hme-stop-detector-verdicts.env. Pure-JS port
// would just be a child_process.spawn of the same Python — same shape, no
// gain. Keep the bash for now; the file-based verdicts contract is what
// matters for downstream policies.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('detectors');
