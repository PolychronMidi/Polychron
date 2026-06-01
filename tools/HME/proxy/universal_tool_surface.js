'use strict';

/** Universal native-looking HME tool surface.
 *
 * Source of truth is tools/HME/hme_tools. Host adapters should request one of
 * these projections instead of redefining tool schemas per host.
 */

const registry = require('./hme_tool_registry');

function toolSurface(kind = 'codex') {
  switch (String(kind || 'codex')) {
    case 'codex':
    case 'openai':
    case 'claude':
      return registry.canonicalToolSchemas();
    case 'langchain':
      return registry.canonicalLangChainTools();
    case 'hme':
    case 'metadata':
      return registry.canonicalToolMetadata();
    default:
      throw new Error(`unknown HME tool surface kind: ${kind}`);
  }
}

function toolNames(kind = 'codex') {
  return toolSurface(kind).map((tool) => tool.name);
}

function toolMetadata(name) {
  return registry.toolMetadata(name);
}

function bridgePlan(name, args = {}) {
  const meta = registry.toolMetadata(name);
  if (!meta) return { ok: false, reason: `unknown HME tool: ${name}` };
  const missing = registry.missingRequiredFields(name, args);
  if (missing.length) return { ok: false, name, missing, reason: `missing required field(s): ${missing.join(', ')}` };
  return {
    ok: true,
    name,
    passthrough_target: meta.hme && meta.hme.passthrough_target || '',
    bridge_action: meta.hme && meta.hme.bridge_action || '',
    host_native: Boolean(meta.hme && meta.hme.host_native),
    requires_approval: registry.requiresApproval(name, args),
    side_effect: meta.hme && meta.hme.side_effect || 'none',
    approval: meta.hme && meta.hme.approval || 'never',
  };
}

module.exports = { toolSurface, toolNames, toolMetadata, bridgePlan };
