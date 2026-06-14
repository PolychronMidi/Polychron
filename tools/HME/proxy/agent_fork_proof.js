'use strict';

function evaluateForkProof(proof, opts = {}) {
  const minRatio = Number.isFinite(opts.minRatio) ? opts.minRatio : 0.8;
  if (!proof || typeof proof !== 'object') return { ok: false, action: 'deny', reason: 'missing_fork_proof' };
  const parent = Number(proof.source_session_tokens || 0);
  const child = Number(proof.agent_context_tokens || 0);
  if (!Number.isFinite(parent) || parent <= 0 || !Number.isFinite(child) || child <= 0) {
    return { ok: false, action: 'deny', reason: 'missing_or_invalid_token_telemetry' };
  }
  if (proof.raw_context_fresh === true) return { ok: false, action: 'deny', reason: 'fresh_context_not_fork' };
  if (proof.telemetry_generated_at && Date.now() - Date.parse(proof.telemetry_generated_at) > (opts.maxAgeMs || 300000)) {
    return { ok: false, action: 'deny', reason: 'stale_token_telemetry' };
  }
  const ratio = child / parent;
  if (ratio < minRatio) return { ok: false, action: 'reroute', reason: 'fork_context_ratio_below_threshold', ratio, minRatio };
  return { ok: true, action: 'allow', reason: 'fork_proof_valid', ratio, minRatio };
}

module.exports = { evaluateForkProof };
