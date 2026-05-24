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

// Pure passthrough: never overwrite body.tools. The Codex CLI ships its own
// tool surface (exec_command) -- the proxy must not hijack it. Retained as a
// no-op so existing callers compile; uniformToolList() is still exported for
function replaceToolsWithUniform(body, _cfg) {
  return { body, stats: { replaced: false, dropped: 0, kept: 0, dropped_names: [] } };
}

module.exports = { TOOLS, UNIFORM_NAMES, uniformToolList, replaceToolsWithUniform };
