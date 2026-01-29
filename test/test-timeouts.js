// Centralized test timeouts so tests don't hardcode numeric literals.
const CHILD_PROC_TIMEOUT = Number(process.env.TEST_CHILD_TIMEOUT) || 60 * 1000;
const SHORT_CHILD_PROC_TIMEOUT = Number(process.env.SHORT_TEST_CHILD_TIMEOUT) || 20 * 1000;
const LONG_CHILD_PROC_TIMEOUT = Number(process.env.LONG_TEST_CHILD_TIMEOUT) || 120 * 1000;
module.exports = { CHILD_PROC_TIMEOUT, SHORT_CHILD_PROC_TIMEOUT, LONG_CHILD_PROC_TIMEOUT };
