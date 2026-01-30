// Compatibility shim: re-export helpers from consolidated `test-setup`
try { module.exports = require('./test-setup'); } catch (e) { module.exports = {}; }
