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
 * Position in order.json: AFTER dump_system (so dumps capture the raw
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

const _RAW = (process.env.HME_FILTER_TOOLS_DROP ?? '').trim();
const DROP_SET = new Set(
  _RAW.split(',').map((s) => s.trim()).filter(Boolean),
);

module.exports = {
  name: 'filter_tools',
  onRequest({ payload, ctx }) {
    if (DROP_SET.size === 0) return;
    if (!payload || !Array.isArray(payload.tools)) return;
    const before = payload.tools.length;
    const kept = payload.tools.filter((t) => {
      const name = t && typeof t.name === 'string' ? t.name : '';
      return !DROP_SET.has(name);
    });
    if (kept.length === before) return;
    payload.tools = kept;
    ctx.markDirty();
  },
};
