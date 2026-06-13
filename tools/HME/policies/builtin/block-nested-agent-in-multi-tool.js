'use strict';
/**
 * Raw/native Agent calls must pass through the Agent PreToolUse hook so HME can
 * apply team routing, forked-context preservation, prompt bounds, and no-fanout
 * rules. multi_tool_use.parallel can hide Agent calls as nested payloads whose
 * outer tool name is the wrapper, bypassing that route. Fail closed: use direct
 * Agent calls (or HME ask-peer/team dispatch) for subagents.
 */

function _nestedAgentNames(input) {
  const uses = Array.isArray(input && input.tool_uses) ? input.tool_uses : [];
  const names = [];
  for (const u of uses) {
    const name = String((u && (u.recipient_name || u.name || u.tool_name)) || '');
    if (/^(functions\.)?Agent$/.test(name) || /\.Agent$/.test(name)) names.push(name);
  }
  return names;
}

module.exports = {
  name: 'block-nested-agent-in-multi-tool',
  description: 'Block Agent calls hidden inside multi_tool_use.parallel; raw Agent route owns forked context and prompt bounds.',
  category: 'tool-surface',
  defaultEnabled: true,
  decisionClass: 'block',
  match: { events: ['PreToolUse'], tools: ['multi_tool_use.parallel'] },
  params: {},
  async fn(ctx) {
    const nested = _nestedAgentNames(ctx.toolInput || {});
    if (nested.length) {
      return ctx.deny(
        `BLOCKED: Agent inside multi_tool_use.parallel bypasses HME's raw Agent fork/context router (${nested.join(', ')}). ` +
        'Launch bounded subagents as direct Agent calls only; do not parallel-wrap Agent.',
      );
    }
    return ctx.allow();
  },
  _nestedAgentNames,
};
