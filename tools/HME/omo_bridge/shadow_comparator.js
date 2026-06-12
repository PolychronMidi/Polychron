'use strict';

const { toUniversalAnthropicEvent } = require('./adapters/anthropic_inbound');
const { assertUniversalDecision } = require('./universal_decision');

const SHADOW_MATCH_EVENT = 'universal_hook_shadow_match';
const SHADOW_MISMATCH_EVENT = 'universal_hook_shadow_mismatch';
const ADAPTER_ERROR_EVENT = 'universal_hook_adapter_error';

function code(value) {
  if (!value || typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function reasonCode(decision = {}) {
  return decision.machineCode
    || decision.machine_code
    || decision.reasonCode
    || decision.reason_code
    || decision.code
    || (decision.reason ? 'reason_present' : '');
}

function decisionSummary(decision = {}) {
  if (decision.unsupported) {
    return {
      kind: 'unsupported',
      reasonCode: code(decision.reason) || 'unsupported',
      target: decision.target || '',
    };
  }
  const kind = decision.kind || (decision.blocked ? 'deny' : 'allow');
  return {
    kind,
    reasonCode: code(reasonCode(decision)),
    target: decision.target || '',
  };
}

function eventSummary(event = {}, fallback = {}) {
  const source = event.source || {};
  const chat = event.chat || {};
  const stream = event.stream || {};
  const tool = event.tool || {};
  return {
    host: fallback.host || source.host || '',
    phase: fallback.phase || event.phase || '',
    adapter: fallback.adapter || source.adapter || '',
    raw_event: source.rawEventName || '',
    event_id: event.id || '',
    model: (event.session || {}).model || '',
    tool_name: tool.name || '',
    message_count: Array.isArray(chat.messages) ? chat.messages.length : 0,
    stream_block_type: stream.blockType || '',
    stream_text_bytes: typeof stream.text === 'string' ? Buffer.byteLength(stream.text) : 0,
  };
}

function emitShadow(event, fields, telemetry) {
  const payload = { event, ...fields };
  if (typeof telemetry === 'function') telemetry(payload);
  return payload;
}

function compareShadowDecisions({ universalEvent, nativeDecision, universalDecision, telemetry }) {
  const nativeSummary = decisionSummary(nativeDecision || { kind: 'allow' });
  const universalSummary = decisionSummary(universalDecision || { kind: 'allow' });
  const matched = nativeSummary.kind === universalSummary.kind
    && nativeSummary.reasonCode === universalSummary.reasonCode;
  return emitShadow(matched ? SHADOW_MATCH_EVENT : SHADOW_MISMATCH_EVENT, {
    ...eventSummary(universalEvent),
    matched,
    native_decision_kind: nativeSummary.kind,
    universal_decision_kind: universalSummary.kind,
    native_reason_code: nativeSummary.reasonCode,
    universal_reason_code: universalSummary.reasonCode,
    native_target: nativeSummary.target,
    universal_target: universalSummary.target,
  }, telemetry);
}

function emitAdapterError({ error, host = '', phase = '', adapter = '', telemetry }) {
  return emitShadow(ADAPTER_ERROR_EVENT, {
    host,
    phase,
    adapter,
    error_type: error && error.name ? error.name : 'Error',
    error_code: code(error && error.message ? error.message : 'adapter_error') || 'adapter_error',
  }, telemetry);
}

function runShadowComparison({ enabled = true, nativeEvent, adapt, adapter = '', host = '', phase = '', nativeDecision, universalDecision, telemetry }) {
  if (!enabled) return { skipped: true, reason: 'disabled' };
  try {
    const universalEvent = adapt(nativeEvent);
    return compareShadowDecisions({ universalEvent, nativeDecision, universalDecision, telemetry });
  } catch (error) {
    return emitAdapterError({ error, host, phase, adapter, telemetry });
  }
}

function pluginResultsToUniversalDecision(results = []) {
  const list = Array.isArray(results) ? results : [results];
  const blocked = list.find((result) => result && result.result === 'blocked');
  if (blocked) {
    return assertUniversalDecision({
      kind: 'deny',
      reason: (blocked.validation && blocked.validation.reason) || 'OMO hook result blocked',
      machineCode: 'omo_hook_blocked',
    });
  }
  const errored = list.find((result) => result && result.result === 'error');
  if (errored) return assertUniversalDecision({ kind: 'defer', reason: 'OMO hook error', machineCode: 'omo_hook_error' });
  return assertUniversalDecision({ kind: 'allow' });
}

function compareProxyRequestShadow({ enabled = true, payload, session, nativeDecision, universalDecision, telemetry }) {
  return runShadowComparison({
    enabled,
    nativeEvent: { body: payload || {}, request_id: session },
    host: 'anthropic',
    phase: 'chat.params',
    adapter: 'anthropic_inbound',
    nativeDecision: nativeDecision || { kind: 'allow' },
    universalDecision: universalDecision || { kind: 'allow' },
    telemetry,
    adapt(native) {
      return toUniversalAnthropicEvent(native, { id: `anthropic-shadow-${session || 'request'}` });
    },
  });
}

module.exports = {
  ADAPTER_ERROR_EVENT,
  SHADOW_MATCH_EVENT,
  SHADOW_MISMATCH_EVENT,
  compareProxyRequestShadow,
  compareShadowDecisions,
  decisionSummary,
  emitAdapterError,
  eventSummary,
  pluginResultsToUniversalDecision,
  runShadowComparison,
};
