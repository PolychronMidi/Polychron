'use strict';
/**
 * Canonical renderer for host-neutral policy decisions at the event-kernel edge.
 * Policy modules return event_kernel/decision values; this file alone translates
 * their aggregate into hookSpecificOutput JSON for hook events.
 */

const PERMISSION_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

function _text(value) {
  return String(value || '').trim();
}

function _messages(items) {
  return (items || []).map((item) => _text(item && item.message)).filter(Boolean);
}

function _hook(eventName, fields) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, ...fields } });
}

function renderDeny(eventName, reason) {
  const message = _text(reason);
  if (PERMISSION_EVENTS.has(eventName)) {
    return _hook(eventName, { permissionDecision: 'deny', permissionDecisionReason: message });
  }
  return _hook(eventName, { additionalContext: message });
}

function renderRewrite(eventName, updatedInput, messages = []) {
  const context = messages.map(_text).filter(Boolean).join('\n');
  const fields = { permissionDecision: 'allow', updatedInput: updatedInput || {} };
  if (context) fields.additionalContext = context;
  return _hook(eventName, fields);
}

function renderInstruct(eventName, messages = []) {
  return _hook(eventName, { additionalContext: messages.map(_text).filter(Boolean).join('\n\n') });
}

function renderPolicyFailure(message, eventName = 'PreToolUse') {
  return renderDeny(eventName, message);
}

function renderPolicyAggregate(aggregate, options = {}) {
  if (!aggregate) return '';
  const eventName = options.eventName || 'PreToolUse';
  const toolInput = options.toolInput || {};
  if (aggregate.firstDeny) return renderDeny(eventName, aggregate.firstDeny.reason || '');
  const rewrites = aggregate.rewrites || [];
  const instructs = aggregate.instructs || [];
  if (rewrites.length && PERMISSION_EVENTS.has(eventName)) {
    return renderRewrite(eventName, toolInput, _messages(instructs));
  }
  if (instructs.length) return renderInstruct(eventName, _messages(instructs));
  return '';
}

module.exports = {
  renderDeny,
  renderRewrite,
  renderInstruct,
  renderPolicyAggregate,
  renderPolicyFailure,
};
