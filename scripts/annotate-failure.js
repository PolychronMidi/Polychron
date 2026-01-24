#!/usr/bin/env node
// Simple CI annotation helper (placeholder). When invoked in CI with environment variables
// this script can be extended to write annotations to GitHub via the REST API or actions' tooling.
const cause = process.env.FAILURE_CAUSE || 'No specific cause provided';
console.log(`CI Annotation helper: ${cause}`);
process.exit(0);
