'use strict';

// Canonical Claude-style tool surface for Codex requests.
// Replaces codex's native tool list with the Claude 7 (Agent..Write).

const TOOLS = [
  {
    type: 'function',
    name: 'Agent',
    description: 'Run a subagent. Example: Agent level=3 prompt="Audit parser edge cases." Use level 1-5: 1 tiny, 2 focused, 3 standard, 4 deep, 5 principal.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'integer', minimum: 1, maximum: 5, description: 'Effort level 1-5.' },
        prompt: { type: 'string', description: 'Focused task for the agent.' },
      },
      required: ['level', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'Bash',
    description: 'Run a bash command and return output. Prefer Read/Edit/Write for file ops. Quote paths with spaces. Use absolute paths; avoid cd unless requested. Use timeout for long commands. Use run_in_background only when notification is enough. Never run destructive git/gh or bypass hooks unless explicitly requested.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute.' },
        timeout: { type: 'number', description: 'Optional timeout in milliseconds (max 600000).' },
        description: { type: 'string', description: 'Brief active-voice description of what this command does.' },
        run_in_background: { type: 'boolean', description: 'Set true to run in the background.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'Edit',
    description: 'Performs exact string replacement in a file. You must Read the file in this conversation before editing. old_string must match the file exactly and be unique unless replace_all is set.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'The absolute path to the file to modify.' },
        old_string: { type: 'string', description: 'The text to replace.' },
        new_string: { type: 'string', description: 'The text to replace it with.' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences (default false).' },
      },
      required: ['file_path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'Read',
    description: 'Read a file by absolute path. Supports offset/limit for long text, images, PDFs (use pages for large PDFs), and notebooks. Returns numbered lines. Does not read directories.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'The absolute path to the file to read.' },
        offset: { type: 'integer', minimum: 0, description: 'Line number to start reading from.' },
        limit: { type: 'integer', minimum: 1, description: 'Number of lines to read.' },
        pages: { type: 'string', description: 'Page range for PDFs, e.g. "1-5".' },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'WebFetch',
    description: 'Fetch and summarize a public URL with a prompt. URL must be valid; redirects require a follow-up request. Avoid private/authenticated URLs; use authenticated MCP or gh for GitHub when available. Read-only, cached briefly, may summarize large pages.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch content from.' },
        prompt: { type: 'string', description: 'The prompt to run on the fetched content.' },
      },
      required: ['url', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'WebSearch',
    description: 'Search the web for current or post-cutoff info. Use 2026 in recent/current queries. Supports allowed/blocked domain filters. If used, final answer must include a Sources section with relevant result links.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, description: 'The search query to use.' },
        allowed_domains: { type: 'array', items: { type: 'string' }, description: 'Only include results from these domains.' },
        blocked_domains: { type: 'array', items: { type: 'string' }, description: 'Exclude results from these domains.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'Write',
    description: 'Writes a file to the local filesystem, overwriting if one exists. Use for creating a new file or fully replacing one you have already Read. For partial changes, use Edit instead.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'The absolute path to the file to write.' },
        content: { type: 'string', description: 'The content to write to the file.' },
      },
      required: ['file_path', 'content'],
      additionalProperties: false,
    },
  },
];

const UNIFORM_NAMES = new Set(TOOLS.map((t) => t.name));

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function uniformToolList() { return TOOLS.map(clone); }

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
