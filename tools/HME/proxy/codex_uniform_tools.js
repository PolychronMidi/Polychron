'use strict';

// Canonical Claude-style tool surface for Codex requests.
// Source of truth is the smolagents HMETool registry under tools/HME/hme_tools.

const { toolSurface } = require('./universal_tool_surface');

function uniformToolList() { return toolSurface('codex'); }

const UNIFORM_NAMES = new Set(uniformToolList().map((t) => t.name));
const TOOLS = uniformToolList();

function uniformToolConfig(cfg) {
  const raw = cfg?.request_transform?.uniform_tools || {};
  const envOff = process.env.HME_CODEX_UNIFORM_TOOLS === '0';
  return { enabled: !envOff && raw.enabled !== false };
}

function replaceToolsWithUniform(body, cfg) {
  const stats = { replaced: false, dropped: 0, kept: 0, dropped_names: [] };
  if (!uniformToolConfig(cfg).enabled) return { body, stats };
  const incoming = Array.isArray(body.tools) ? body.tools : [];
  const droppedNames = [];
  for (const tool of incoming) {
    const name = tool && (tool.name || (tool.function && tool.function.name) || '');
    if (name && !UNIFORM_NAMES.has(name)) droppedNames.push(name);
  }
  stats.dropped = droppedNames.length;
  stats.dropped_names = droppedNames.slice(0, 32);
  stats.kept = UNIFORM_NAMES.size;
  stats.replaced = true;
  return { body: { ...body, tools: uniformToolList() }, stats };
}

module.exports = { TOOLS, UNIFORM_NAMES, uniformToolList, replaceToolsWithUniform };
