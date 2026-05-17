'use strict';
/**
 * Drop tool definitions you never use from the request before it reaches
 * Anthropic. The `tools` array is ~60KB on every request -- bigger than
 * the system prompt -- and most projects don't need all 26 default tools
 * Claude Code ships (Google Drive MCP, CronCreate/List/Delete, Monitor,
 * RemoteTrigger, EnterWorktree/ExitWorktree, WebFetch, WebSearch, etc.).
 *
 * Removing a tool means the agent literally cannot call it. This is a
 * STRUCTURAL cut, not behavioral conditioning -- verify your workflow
 * doesn't need a tool before adding it to the filter list.
 *
 * Load order (NN_ prefix): AFTER dump_system (so dumps capture the raw
 * tool list for inspection) and BEFORE HME's injection middleware.
 *
 * Configuration via .env:
 *   HME_FILTER_TOOLS_DROP=tool1,tool2,...   comma-separated tool names
 *                                            to remove from payload.tools
 *
 * Empty / unset -> no-op (zero cost).
 *
 * Tool names match exactly (case-sensitive) against the `name` field in
 * each tool definition. To see the current tool surface:
 *   HME_DUMP_SYSTEM_PROMPT=1 in .env, restart proxy, fire any request,
 *   read tmp/claude-full-payload.json and look at the `tools[].name` list.
 */

const fs = require('fs');
const path = require('path');

function _stripInlineComment(value) {
  return String(value || '').replace(/\s+#.*$/, '').trim();
}

function _dropSet(projectRoot) {
  const raw = [process.env.HME_FILTER_TOOLS_DROP || ''];
  try {
    const envPath = path.join(projectRoot || process.cwd(), '.env');
    const text = fs.readFileSync(envPath, 'utf8');
    const line = text.split(/\r?\n/).find((l) => /^\s*HME_FILTER_TOOLS_DROP\s*=/.test(l));
    if (line) raw.push(line.replace(/^\s*HME_FILTER_TOOLS_DROP\s*=\s*/, ''));
  } catch (_err) { /* optional config */ }
  return new Set(raw.flatMap((s) => _stripInlineComment(s).split(',')).map((s) => s.trim()).filter(Boolean));
}

module.exports = {
  name: 'filter_tools',
  onRequest({ payload, ctx }) {
    if (DROP_SET.size === 0) return;
    if (!payload || !Array.isArray(payload.tools)) return;
    const before = payload.tools.length;
    // Rescue cache_control from any dropped tool: Claude Code attaches the
    let rescuedCC = null;
    const kept = payload.tools.filter((t) => {
      const name = t && typeof t.name === 'string' ? t.name : '';
      const drop = DROP_SET.has(name);
      if (drop && t && t.cache_control) rescuedCC = t.cache_control;
      return !drop;
    });
    if (kept.length === before) return;
    if (rescuedCC && kept.length > 0) {
      const last = kept[kept.length - 1];
      if (last && !last.cache_control) last.cache_control = rescuedCC;
    }
    payload.tools = kept;
    ctx.markDirty();
  },
};
