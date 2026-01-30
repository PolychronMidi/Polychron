// Compatibility shim: merged into test-setup.js
require('./test-setup');
module.exports = require('./test-setup').TEST_HOOKS || {};
