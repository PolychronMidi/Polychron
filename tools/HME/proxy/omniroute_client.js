'use strict';

/* Anti-corruption layer for the OmniRoute upstream. Encapsulates provider-prefix
 * conventions, target-format selection, transient-failure classification, and
 * URL/port lookup; callers stay free of OmniRoute schema drift. */
const protocol = require('./omniroute_protocol');
const { servicePort } = require('./service_registry');

// rationale: 502 stream_timeout / STREAM_READINESS_TIMEOUT = upstream SSE closed empty.
const TRANSIENT_FAILURE_TYPES = new Set(['stream_timeout']);
const TRANSIENT_FAILURE_CODES = new Set(['STREAM_READINESS_TIMEOUT']);

function port(env = process.env) { return env.HME_OMNIROUTE_PORT || servicePort('omniroute', env); }
function targetUrl(env = process.env) { return `http://127.0.0.1:${port(env)}`; }
function providerPrefixFor(configProvider, env = process.env) { return protocol.omniProviderForConfigProvider(configProvider, env); }
function isCodexTarget(configProvider) { return protocol.isCodexOmniTarget(configProvider); }
function targetFormatFor(configProvider) { return protocol.omniTargetFormat(configProvider); }
function firstLegacyChatCandidate(chain, startIdx = 0) { return protocol.firstLegacyChatCandidate(chain, startIdx); }

// rationale: qualify "anthropic" + "claude-opus-4-7" -> "claude/claude-opus-4-7".
function qualifyModel(configProvider, modelId, env = process.env) {
  const prefix = providerPrefixFor(configProvider, env);
  const raw = String(modelId || '');
  if (!raw) return prefix;
  if (raw.includes('/')) return raw;
  return `${prefix}/${raw}`;
}

// rationale: classify failure as transient (same-target retry worth attempting).
function isTransientStreamTimeout({ status, errInfo, body }) {
  if (status !== 502) return false;
  if (errInfo) {
    if (errInfo.type && TRANSIENT_FAILURE_TYPES.has(errInfo.type)) return true;
    if (errInfo.code && TRANSIENT_FAILURE_CODES.has(errInfo.code)) return true;
  }
  const txt = typeof body === 'string' ? body : (body && body.toString ? body.toString('utf8') : '');
  return /STREAM_READINESS_TIMEOUT|"type":"stream_timeout"/.test(txt);
}

module.exports = {
  TRANSIENT_FAILURE_TYPES,
  TRANSIENT_FAILURE_CODES,
  port,
  targetUrl,
  providerPrefixFor,
  isCodexTarget,
  targetFormatFor,
  qualifyModel,
  firstLegacyChatCandidate,
  isTransientStreamTimeout,
};
