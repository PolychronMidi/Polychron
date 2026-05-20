'use strict';
const { requiresApproval } = require('../proxy/hme_tool_registry');
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
module.exports = { classifyOmoAction, checkOmoAction };
