'use strict';
/**
 * Host-neutral HME decision algebra.
 *
 * Hook adapters, policy registries, stop-chain policies, and middleware gates all
 * need the same small result vocabulary. Keep this module free of Claude/Codex
 * protocol details; host-specific rendering belongs in adapters/normalizers.
 */

function _meta(meta) {
  return meta && typeof meta === 'object' ? { ...meta } : {};
}

function _withMeta(base, meta) {
  const m = _meta(meta);
  return Object.keys(m).length > 0 ? { ...base, meta: m } : base;
}

const TYPES = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  INSTRUCT: 'instruct',
  REWRITE: 'rewrite',
  ERROR: 'error',
});

function allow(message = null, meta = {}) {
  return _withMeta({ decision: TYPES.ALLOW, message: message || null }, meta);
}

function deny(reason = '', meta = {}) {
  return _withMeta({ decision: TYPES.DENY, reason: reason || '' }, meta);
}

function instruct(message = '', meta = {}) {
  return _withMeta({ decision: TYPES.INSTRUCT, message: message || '' }, meta);
}

function rewrite(updatedInput = {}, message = '', meta = {}) {
  return _withMeta({ decision: TYPES.REWRITE, updatedInput: updatedInput || {}, message: message || '' }, meta);
}

function error(message = '', failMode = 'open', meta = {}) {
  return _withMeta({ decision: TYPES.ERROR, message: message || '', failMode: failMode || 'open' }, meta);
}

function kindOf(decision) {
  return decision && typeof decision === 'object' ? decision.decision || '' : '';
}

function isAllow(decision) {
  return kindOf(decision) === TYPES.ALLOW;
}

function isDeny(decision) {
  return kindOf(decision) === TYPES.DENY;
}

function isInstruct(decision) {
  return kindOf(decision) === TYPES.INSTRUCT;
}

function isRewrite(decision) {
  return kindOf(decision) === TYPES.REWRITE;
}

function isError(decision) {
  return kindOf(decision) === TYPES.ERROR;
}

function combineFirstDeny(results) {
  const out = { firstDeny: null, instructs: [], rewrites: [], errors: [] };
  for (const item of results || []) {
    if (!item) continue;
    if (isDeny(item) && !out.firstDeny) out.firstDeny = item;
    else if (isInstruct(item) && item.message) out.instructs.push(item);
    else if (isRewrite(item)) out.rewrites.push(item);
    else if (isError(item)) out.errors.push(item);
  }
  return out;
}

module.exports = {
  TYPES,
  allow,
  deny,
  instruct,
  rewrite,
  error,
  kindOf,
  isAllow,
  isDeny,
  isInstruct,
  isRewrite,
  isError,
  combineFirstDeny,
};
