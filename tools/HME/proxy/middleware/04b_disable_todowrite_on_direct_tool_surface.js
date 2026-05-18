'use strict';

function toolNames(payload) {
  return Array.isArray(payload && payload.tools)
    ? payload.tools.map((tool) => tool && tool.name).filter(Boolean)
    : [];
}

function isDirectToolSurface(payload) {
  const names = new Set(toolNames(payload));
  return names.has('Bash') || names.has('Read') || names.has('Edit') || names.has('Write') || names.has('Agent');
}

module.exports = {
  name: 'disable_todowrite_on_direct_tool_surface',
  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.tools)) return;
    if (!isDirectToolSurface(payload)) return;
    const before = payload.tools.length;
    payload.tools = payload.tools.filter((tool) => !(tool && tool.name === 'TodoWrite'));
    if (payload.tools.length !== before) ctx.markDirty();
  },
};
