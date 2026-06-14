'use strict';

const TELEMETRY_SOURCE = Object.freeze({
  name: 'omniroute_token_telemetry',
  required_fields: ['source_session_tokens', 'agent_context_tokens', 'telemetry_generated_at', 'route_id'],
  stores_raw_payload: false,
});

function evaluateForkProof(proof, opts = {}) {
  const minRatio = Number.isFinite(opts.minRatio) ? opts.minRatio : 0.8;
  if (!proof || typeof proof !== 'object') return { ok: false, action: 'deny', reason: 'missing_fork_proof' };
  const parent = Number(proof.source_session_tokens || 0);
  const child = Number(proof.agent_context_tokens || 0);
  if (!Number.isFinite(parent) || parent <= 0 || !Number.isFinite(child) || child <= 0) {
    return { ok: false, action: 'deny', reason: 'missing_or_invalid_token_telemetry' };
  }
  if (proof.raw_context_fresh === true) return { ok: false, action: 'deny', reason: 'fresh_context_not_fork' };
  if (!proof.telemetry_generated_at && opts.requireFreshTelemetry === true) {
    return { ok: false, action: 'deny', reason: 'missing_token_telemetry_timestamp' };
  }
  if (proof.telemetry_generated_at && Date.now() - Date.parse(proof.telemetry_generated_at) > (opts.maxAgeMs || 300000)) {
    return { ok: false, action: 'deny', reason: 'stale_token_telemetry' };
  }
  const ratio = child / parent;
  if (ratio < minRatio) return { ok: false, action: 'reroute', reason: 'fork_context_ratio_below_threshold', ratio, minRatio };
  return { ok: true, action: 'allow', reason: 'fork_proof_valid', ratio, minRatio };
}

function validateBoundedPromptMetadata(meta = {}, opts = {}) {
  const errors = [];
  const maxFiles = Number.isFinite(opts.maxFiles) ? opts.maxFiles : 8;
  const maxWords = Number.isFinite(opts.maxWords) ? opts.maxWords : 1200;
  if (!meta || typeof meta !== 'object') return { ok: false, errors: ['missing prompt metadata'] };
  if (Number(meta.max_files || 0) <= 0 || Number(meta.max_files || 0) > maxFiles) errors.push('max_files outside bound');
  if (Number(meta.max_words || 0) <= 0 || Number(meta.max_words || 0) > maxWords) errors.push('max_words outside bound');
  if (meta.no_subagents !== true) errors.push('missing no_subagents=true');
  if (meta.no_multi_tool_agent !== true) errors.push('missing no_multi_tool_agent=true');
  if (meta.default_fork !== true) errors.push('missing default_fork=true');
  return { ok: errors.length === 0, errors };
}

function validateEmergencyAllowlist(entry, now = Date.now()) {
  const errors = [];
  if (!entry || typeof entry !== 'object') return { ok: false, errors: ['missing allowlist entry'] };
  if (typeof entry.owner !== 'string' || !entry.owner.trim()) errors.push('missing owner');
  if (typeof entry.reason !== 'string' || !entry.reason.trim()) errors.push('missing reason');
  if (typeof entry.expires_at !== 'string' || Number.isNaN(Date.parse(entry.expires_at))) errors.push('invalid expires_at');
  else if (Date.parse(entry.expires_at) <= now) errors.push('expired allowlist');
  if (!Array.isArray(entry.audit_trail) || entry.audit_trail.length === 0) errors.push('missing audit_trail');
  return { ok: errors.length === 0, errors };
}

function evaluateAgentLaunch(input = {}, opts = {}) {
  const allowlist = validateEmergencyAllowlist(input.emergency_allowlist, opts.now || Date.now());
  if (allowlist.ok) return { ok: true, action: 'allow', reason: 'emergency_allowlist', allowlist: input.emergency_allowlist };
  const fork = evaluateForkProof(input.proof, { ...opts, requireFreshTelemetry: opts.requireFreshTelemetry !== false });
  if (!fork.ok) return fork;
  const bounded = validateBoundedPromptMetadata(input.prompt_metadata, opts);
  if (!bounded.ok) return { ok: false, action: 'deny', reason: 'unbounded_prompt_metadata', errors: bounded.errors };
  return { ok: true, action: 'allow', reason: 'fork_and_prompt_bounds_valid', fork, prompt_metadata: input.prompt_metadata };
}

module.exports = {
  TELEMETRY_SOURCE,
  evaluateForkProof,
  validateBoundedPromptMetadata,
  validateEmergencyAllowlist,
  evaluateAgentLaunch,
};
