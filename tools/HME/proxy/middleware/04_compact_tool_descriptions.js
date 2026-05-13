'use strict';

const COMPACT = {
  Read: `Read a file by absolute path. Supports offset/limit for long text, images, PDFs (use pages for large PDFs), and notebooks. Returns numbered lines. Use for screenshots when given a path. Does not read directories.`,
  Agent: `Launch a subagent or fork. Required: description, prompt. Use subagent_type for named specialists; omit it for a context-inheriting fork. Keep prompts scoped and self-contained for fresh subagents. Do not peek at output_file; wait for completion. Verify any code changes before reporting. Use parallel Agent calls only for independent work.`,
  Bash: `Run a bash command and return output. Prefer Read/Edit/Write for file operations. Quote paths with spaces. Use absolute paths; avoid cd unless requested. Use timeout for long commands and run_in_background only when you can wait for notification. Never use destructive git/gh or bypass hooks unless explicitly requested.`,
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
