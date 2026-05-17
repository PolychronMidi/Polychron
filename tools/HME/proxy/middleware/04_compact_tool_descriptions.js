'use strict';

const AGENT_DESCRIPTION = `Run a subagent. Example: Agent level=3 prompt="Audit parser edge cases." Use level 1-5: 1 tiny, 2 focused, 3 standard, 4 deep, 5 principal.`;

const AGENT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    level: { description: 'Effort level 1-5.', type: 'integer', minimum: 1, maximum: 5 },
    prompt: { description: 'Focused task for the agent.', type: 'string' },
  },
  required: ['level', 'prompt'],
  additionalProperties: false,
};

const TODOWRITE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          activeForm: { type: 'string' },
        },
        required: ['content', 'status', 'activeForm'],
        additionalProperties: true,
      },
    },
  },
  required: ['todos'],
  additionalProperties: false,
};

const COMPACT = {
  Read: `Read a file by absolute path. Supports offset/limit for long text, images, PDFs (use pages for large PDFs), and notebooks. Returns numbered lines. Use for screenshots when given a path. Does not read directories.`,
  Bash: `Run a bash command and return output. Prefer Read/Edit/Write for file ops. Quote paths with spaces. Use absolute paths; avoid cd unless requested. Use timeout for long commands. Use run_in_background only when notification is enough. Never run destructive git/gh or bypass hooks unless explicitly requested.`,
  TodoWrite: `Maintain a session task list for non-trivial multi-step work or when requested. Keep exactly one item in_progress. Mark items completed only when fully done and verified; keep blockers in progress or add a blocker task. Each todo needs content plus activeForm. Skip for trivial or purely informational requests.`,
  WebFetch: `Fetch and summarize a public URL with a prompt. URL must be valid; redirects require a follow-up request. Avoid private/authenticated URLs; use authenticated MCP or gh for GitHub when available. Read-only, cached briefly, may summarize large pages.`,
  WebSearch: `Search the web for current or post-cutoff info. Use 2026 in recent/current queries. Supports allowed/blocked domain filters. If used, final answer must include a Sources section with relevant result links.`,
};

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function rewriteAgent(tool) {
  let changed = false;
  if (tool.description !== AGENT_DESCRIPTION) {
    tool.description = AGENT_DESCRIPTION;
    changed = true;
  }
  if (!sameJson(tool.input_schema, AGENT_SCHEMA)) {
    tool.input_schema = JSON.parse(JSON.stringify(AGENT_SCHEMA));
    changed = true;
  }
  return changed;
}

function ensureTodoWrite(tools) {
  if (tools.some((tool) => tool && tool.name === 'TodoWrite')) return false;
  tools.push({
    name: 'TodoWrite',
    description: COMPACT.TodoWrite,
    input_schema: JSON.parse(JSON.stringify(TODOWRITE_SCHEMA)),
  });
  return true;
}

module.exports = {
  name: 'compact_tool_descriptions',
  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.tools)) return;
    let changed = false;
    for (const tool of payload.tools) {
      if (!tool || typeof tool.name !== 'string') continue;
      if (tool.name === 'Agent') {
        if (rewriteAgent(tool)) changed = true;
        continue;
      }
      const desc = COMPACT[tool.name];
      if (!desc || tool.description === desc) continue;
      tool.description = desc;
      changed = true;
    }
    if (changed) ctx.markDirty();
  },
};
