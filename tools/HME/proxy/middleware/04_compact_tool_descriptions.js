'use strict';

const COMPACT = {
  Read: `Read a file by absolute path. Supports offset/limit for long text, images, PDFs (use pages for large PDFs), and notebooks. Returns numbered lines. Use for screenshots when given a path. Does not read directories.`,
  Agent: `Launch a subagent or fork. Required: description, prompt. Use subagent_type for named specialists; omit it for a context-inheriting fork. Keep prompts scoped and self-contained for fresh subagents. Do not peek at output_file; wait for completion. Verify any code changes before reporting. Use parallel Agent calls only for independent work.`,
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
  _COMPACT: COMPACT,
};
