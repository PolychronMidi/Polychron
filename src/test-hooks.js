// Centralized test hooks object to avoid global mutation in tests.
// Tests can require this module and set properties like DEBUG, enableLogging,
// or inject replacements for fs, LM, etc.

module.exports = {};
