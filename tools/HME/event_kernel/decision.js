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

function allow(message = null, meta = {}) {
  return { decision: 'allow', message: message || null, meta: _meta(meta) };
}

function deny(reason = '', meta = {}) {
  return { decision: 'deny', reason: reason || '', meta: _meta(meta) };
}

function instruct(message = '', meta = {}) {
  return { decision: 'instruct', message: message || '', meta: _meta(meta) };
}

function rewrite(updatedInput = {}, message = '', meta = {}) {
  return { decision: 'rewrite', updatedInput: updatedInput || {}, message: message || '', meta: _meta(meta) };
}

function error(message = '', failMode = 'open', meta = {}) {
  return { decision: 'error', message: message || '', failMode: failMode || 'open', meta: _meta(meta) };
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
