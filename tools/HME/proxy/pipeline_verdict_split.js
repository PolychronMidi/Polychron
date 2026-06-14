'use strict';

function splitVerdict(summary = {}) {
  const behavioral = summary.verdict || summary.behavioral_verdict || 'UNKNOWN';
  const failed = Number(summary.failed || 0);
  const diagnosticFailures = summary.diagnostic_failures || summary.errorPatterns || [];
  const selfFailures = summary.self_coherence_failures || [];
  const diagnostic = failed > 0 || diagnosticFailures.length > 0 ? 'FAIL' : 'PASS';
  const self = selfFailures.length > 0 ? 'FAIL' : 'PASS';
  const exit_policy = diagnostic === 'FAIL' || self === 'FAIL'
    ? 'fail unless explicit owner/reason/expiry allowlist exists'
    : 'pass';
  return {
    behavioral_verdict: behavioral,
    diagnostic_verdict: diagnostic,
    self_coherence_verdict: self,
    exit_policy,
  };
}

module.exports = { splitVerdict };
