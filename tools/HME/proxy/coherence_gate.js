'use strict';

const { validateClaim, isCurrent } = require('./coherence_claims');

function evaluateClaims(claims, invalidators = []) {
  const failures = [];
  for (const claim of claims || []) {
    const validation = validateClaim(claim);
    if (!validation.ok) {
      failures.push({ claim_id: claim && claim.claim_id, reason: 'schema_invalid', errors: validation.errors });
      continue;
    }
    if (!claim.repair) failures.push({ claim_id: claim.claim_id, reason: 'missing_repair' });
    if (!claim.freshness_proof) failures.push({ claim_id: claim.claim_id, reason: 'missing_freshness_proof' });
    const cur = isCurrent(claim, invalidators);
    if (!cur.current && claim.status !== 'stale') failures.push({ claim_id: claim.claim_id, reason: 'stale_claim_presented_current', currentness: cur });
  }
  return { ok: failures.length === 0, failures };
}

module.exports = { evaluateClaims };
