#!/usr/bin/env node
'use strict';

const { gateRuntimeClaims } = require('../proxy/coherence_gate');

function main(argv = process.argv.slice(2)) {
  const strict = argv.includes('--strict');
  const report = gateRuntimeClaims({ strict });
  console.log(JSON.stringify({ ok: report.ok, claim_count: report.claim_count, invalidator_count: report.invalidator_count, failures: report.failures.length }, null, 2));
  if (!report.ok) {
    for (const f of report.failures.slice(0, 20)) console.error(`${f.claim_id || f.file || '?'}: ${f.reason}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { main };
