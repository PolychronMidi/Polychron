'use strict';

const COMPACT = {
  Read: `Read a file by absolute path. Supports offset/limit for long text, images, PDFs (use pages for large PDFs), and notebooks. Returns numbered lines. Use for screenshots when given a path. Does not read directories.`,
  Agent: `Launch a subagent or fork. Required: description, prompt. Use subagent_type for named specialists; omit it for a context-inheriting fork. Keep prompts scoped and self-contained for fresh subagents. Do not peek at output_file; wait for completion. Verify any code changes before reporting. Use parallel Agent calls only for independent work.`,
  Bash: `Run a bash command and return output. Prefer Read/Edit/Write for file ops. Quote paths with spaces. Use absolute paths; avoid cd unless requested. Use timeout for long commands. Use run_in_background only when notification is enough. Never run destructive git/gh or bypass hooks unless explicitly requested.`,
  TodoWrite: `Maintain a session task list for non-trivial multi-step work or when requested. Keep exactly one item in_progress. Mark items completed only when fully done and verified; keep blockers in progress or add a blocker task. Each todo needs content plus activeForm. Skip for trivial or purely informational requests.`,
  WebFetch: `Fetch and summarize a public URL with a prompt. URL must be valid; redirects require a follow-up request. Avoid private/authenticated URLs; use authenticated MCP or gh for GitHub when available. Read-only, cached briefly, may summarize large pages.`,
  WebSearch: `Search the web for current or post-cutoff info. Use 2026 in recent/current queries. Supports allowed/blocked domain filters. If used, final answer must include a Sources section with relevant result links.`,
};

module.exports = {
  name: 'compact_tool_descriptions',
  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.tools)) return;
    let changed = false;
    for (const tool of payload.tools) {
      if (!tool || typeof tool.name !== 'string') continue;
      const desc = COMPACT[tool.name];
      if (!desc || tool.description === desc) continue;
      tool.description = desc;
      changed = true;
    }
    if (changed) ctx.markDirty();
  },
};
