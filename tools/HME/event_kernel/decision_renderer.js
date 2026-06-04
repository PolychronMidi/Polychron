'use strict';
/**
 * Host-neutral Decision aggregate -> hook stdout renderer.
 *
 * Policy code must return event_kernel/decision values. This boundary is the
 * only place unified policies become hookSpecificOutput JSON.
 */

function _messages(items) {
  return (items || []).map((item) => item && item.message).filter(Boolean);
}

function _contextLines(aggregate) {
  return [..._messages(aggregate.rewrites), ..._messages(aggregate.instructs)];
}

function _hookSpecific(eventName, fields) {
  return { hookSpecificOutput: { hookEventName: eventName, ...fields } };
}

function renderPolicyFailure(message, eventName = 'PreToolUse') {
  if (eventName === 'PreToolUse') {
    return JSON.stringify(_hookSpecific('PreToolUse', {
      permissionDecision: 'deny',
      permissionDecisionReason: message,
    }));
  }
  return JSON.stringify(_hookSpecific(eventName, { additionalContext: message }));
}

function renderPolicyAggregate(aggregate, options = {}) {
  const eventName = options.eventName || 'PreToolUse';
  const toolInput = options.toolInput || {};
  const firstDeny = aggregate && aggregate.firstDeny;
  if (firstDeny) {
    if (eventName === 'PreToolUse') {
      return JSON.stringify(_hookSpecific('PreToolUse', {
        permissionDecision: 'deny',
        permissionDecisionReason: firstDeny.reason || '',
      }));
    }
    return JSON.stringify(_hookSpecific(eventName, { additionalContext: firstDeny.reason || '' }));
  }
  const rewrites = aggregate && aggregate.rewrites || [];
  const instructs = aggregate && aggregate.instructs || [];
  if (rewrites.length && eventName === 'PreToolUse') {
    return JSON.stringify(_hookSpecific('PreToolUse', {
      permissionDecision: 'allow',
      updatedInput: toolInput,
      additionalContext: _contextLines({ rewrites, instructs }).join('\n'),
    }));
  }
  if (instructs.length) {
    return JSON.stringify(_hookSpecific(eventName, { additionalContext: _messages(instructs).join('\n\n') }));
  }
  return '';
}

module.exports = {
  renderPolicyAggregate,
  renderPolicyFailure,
};
