'use strict';
const { canonicalLangChainTools } = require('../proxy/hme_tool_registry');
const { emitOmo } = require('./telemetry');

const MUTATING_EFFECTS = new Set(['write', 'edit', 'shell', 'network', 'agent']);
function toOmoToolDescriptor(tool) {
  const meta = tool.metadata || {};
  const sideEffect = meta.side_effect || 'unknown';
  return {
    name: tool.name,
    description: tool.description || '',
    input_schema: tool.args_schema || { type: 'object', properties: {}, required: [] },
    metadata: {
      ...meta,
      hme_bridge: 'omo',
      bridge_action: meta.bridge_action || tool.name,
      mutating: MUTATING_EFFECTS.has(sideEffect),
      hme_policy_authority: true,
    },
  };
}
function hmeToolsForOmo(options = {}) {
  const tools = (options.tools || canonicalLangChainTools()).map(toOmoToolDescriptor);
  emitOmo('omo_tool_bridge_exported', { count: tools.length }, options.telemetry);
  return tools;
}
module.exports = { hmeToolsForOmo, toOmoToolDescriptor };
