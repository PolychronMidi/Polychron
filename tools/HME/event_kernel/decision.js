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

function allow(message = null, meta = {}) {
  return _withMeta({ decision: 'allow', message: message || null }, meta);
}

function deny(reason = '', meta = {}) {
  return _withMeta({ decision: 'deny', reason: reason || '' }, meta);
}

function instruct(message = '', meta = {}) {
  return _withMeta({ decision: 'instruct', message: message || '' }, meta);
}

function rewrite(updatedInput = {}, message = '', meta = {}) {
  return _withMeta({ decision: 'rewrite', updatedInput: updatedInput || {}, message: message || '' }, meta);
}

function error(message = '', failMode = 'open', meta = {}) {
  return _withMeta({ decision: 'error', message: message || '', failMode: failMode || 'open' }, meta);
}

function isDeny(decision) {
  return Boolean(decision && decision.decision === 'deny');
}

function isInstruct(decision) {
  return Boolean(decision && decision.decision === 'instruct');
}

function isRewrite(decision) {
  return Boolean(decision && decision.decision === 'rewrite');
}

function combineFirstDeny(results) {
  const out = { firstDeny: null, instructs: [], rewrites: [], errors: [] };
  for (const item of results || []) {
    if (!item) continue;
    if (isDeny(item) && !out.firstDeny) out.firstDeny = item;
    else if (isInstruct(item) && item.message) out.instructs.push(item);
    else if (isRewrite(item)) out.rewrites.push(item);
    else if (item.decision === 'error') out.errors.push(item);
  }
  return out;
}

module.exports = {
  allow,
  deny,
  instruct,
  rewrite,
  error,
  isDeny,
  isInstruct,
  isRewrite,
  combineFirstDeny,
};
