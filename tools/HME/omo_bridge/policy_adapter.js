'use strict';
const { requiresApproval } = require('../proxy/hme_tool_registry');
const { preWriteCheck } = require('../proxy/pre_write_check');
const { dispatchEvent } = require('../event_kernel/dispatcher');
const { emitOmo } = require('./telemetry');

function classifyOmoAction(action = {}) {
  const type = String(action.type || action.kind || action.tool || '').toLowerCase();
  const name = String(action.tool || action.name || action.type || '');
  if (['write', 'edit', 'multiedit'].includes(type) || ['Write', 'Edit', 'MultiEdit'].includes(name)) return 'write';
  if (type === 'bash' || name === 'Bash' || action.command) return 'shell';
  if (type === 'web' || type === 'network' || ['WebFetch', 'WebSearch'].includes(name)) return 'network';
  if (type === 'agent' || name === 'Agent') return 'agent';
  return 'read';
}
function _payload(action, tool, options) {
  return JSON.stringify({
    session_id: options.sessionId || action.session_id || action.sessionID || 'omo',
    tool_name: tool,
    tool_input: action.input || action.args || action,
    _hme_origin: 'omo_bridge',
  });
}
function checkOmoAction(action = {}, options = {}) {
  const category = classifyOmoAction(action);
  const tool = action.tool || action.name || (category === 'shell' ? 'Bash' : '');
  const args = action.input || action.args || action;
  let allowed = true;
  let reason = 'allowed';
  if (category !== 'read' && options.allowMutations !== true) {
    allowed = false;
    reason = `OMO ${category} action requires HME policy execution path`;
  }
  if (allowed && tool && requiresApproval(tool, args) && options.approved !== true) {
    allowed = false;
    reason = `OMO ${tool} action requires explicit approval`;
  }
  const result = { allowed, category, tool, reason };
  emitOmo(allowed ? 'omo_policy_checked' : 'omo_tool_blocked', { category, tool, result: allowed ? 'allowed' : 'blocked', reason }, options.telemetry);
  return result;
}
async function checkOmoActionThroughHme(action = {}, options = {}) {
  const category = classifyOmoAction(action);
  const tool = action.tool || action.name || (category === 'shell' ? 'Bash' : '');
  let decision;
  if (category === 'write') {
    const w = await preWriteCheck(_payload(action, tool, options));
    decision = { allowed: w.permissionDecision === 'allow', category, tool, reason: w.reason || 'allowed', hmeDecision: w };
  } else if (category === 'shell' || category === 'network' || category === 'agent') {
    const res = await dispatchEvent('PreToolUse', _payload(action, tool, options));
    let parsed = {};
    try { parsed = JSON.parse(res.stdout || '{}'); } catch (_) { parsed = {}; }
    const hso = parsed.hookSpecificOutput || {};
    const denied = parsed.decision === 'block' || hso.permissionDecision === 'deny';
    decision = { allowed: !denied, category, tool, reason: parsed.reason || hso.permissionDecisionReason || 'allowed', hmeResult: res };
  } else {
    decision = checkOmoAction(action, { ...options, allowMutations: true, approved: true });
  }
  emitOmo(decision.allowed ? 'omo_policy_checked' : 'omo_tool_blocked', { category, tool, result: decision.allowed ? 'allowed' : 'blocked', reason: decision.reason, path: 'hme' }, options.telemetry);
  return decision;
}
module.exports = { classifyOmoAction, checkOmoAction, checkOmoActionThroughHme };
