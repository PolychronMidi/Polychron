'use strict';

function _allowlistActive(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return false;
  if (!row.owner || !row.reason || !row.expires_at || !row.regression) return false;
  const t = Date.parse(row.expires_at);
  return !Number.isNaN(t) && t > now;
}

function activeAllowlist(allowlist = [], now = Date.now()) {
  return (allowlist || []).filter((row) => _allowlistActive(row, now));
}

function splitVerdict(summary = {}) {
  const behavioral = summary.verdict || summary.behavioral_verdict || 'UNKNOWN';
  const failed = Number(summary.failed || 0);
  const diagnosticFailures = summary.diagnostic_failures || summary.errorPatterns || [];
  const selfFailures = summary.self_coherence_failures || [];
  const allowlist = activeAllowlist(summary.allowlist || summary.nonfatal_allowlist || [], summary.now || Date.now());
  const diagnosticRaw = failed > 0 || diagnosticFailures.length > 0 ? 'FAIL' : 'PASS';
  const selfRaw = selfFailures.length > 0 ? 'FAIL' : 'PASS';
  const diagnostic = diagnosticRaw === 'FAIL' && allowlist.some((a) => a.scope === 'diagnostic' || a.scope === 'all') ? 'ALLOWLISTED_FAIL' : diagnosticRaw;
  const self = selfRaw === 'FAIL' && allowlist.some((a) => a.scope === 'self_coherence' || a.scope === 'all') ? 'ALLOWLISTED_FAIL' : selfRaw;
  const exit_policy = diagnosticRaw === 'FAIL' || selfRaw === 'FAIL'
    ? 'fail unless explicit owner/reason/expiry allowlist exists'
    : 'pass';
  return {
    behavioral_verdict: behavioral,
    diagnostic_verdict: diagnostic,
    self_coherence_verdict: self,
    exit_policy,
    active_allowlist_count: allowlist.length,
  };
}

module.exports = { splitVerdict, activeAllowlist };
