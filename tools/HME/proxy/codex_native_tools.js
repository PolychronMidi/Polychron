'use strict';

const { evaluateBashInput, blockedCommand } = require('./bash_command_policy');
const { evaluateReadInput } = require('./read_policy');
const { replaceToolsWithUniform } = require('./codex_uniform_tools');

const BRIDGE = 'node tools/HME/scripts/codex_structured_tool.js';
const TARGET_TOOL = 'exec_command';
const WEB_SEARCH_TOOL = 'web_search';
const BRIDGE_NAMES = new Set(['Read', 'Edit', 'Write', 'WebFetch', 'Agent']);
const RENAME_TARGETS = { Bash: TARGET_TOOL, WebSearch: WEB_SEARCH_TOOL };

const READ_TOOL = {
  type: 'function',
  name: 'Read',
  description: 'Read a file from the current project. Prefer this over shell commands for file inspection.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Project file path to read.' },
      offset: { type: 'number', description: 'Optional zero-based line offset.' },
      limit: { type: 'number', description: 'Optional maximum number of lines.' },
    },
    required: ['file_path'],
    additionalProperties: false,
  },
};

const EDIT_TOOL = {
  type: 'function',
  name: 'Edit',
  description: 'Replace one exact, unique string in a project file. Prefer this over shell text replacement.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Project file path to edit.' },
      old_string: { type: 'string', description: 'Exact existing text to replace; must be unique.' },
      new_string: { type: 'string', description: 'Replacement text.' },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
};


const GREP_TOOL = {
  type: 'function',
  name: 'Grep',
  description: 'Search project files with bounded, HME-enriched output. Prefer this over shell grep/rg.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex or fixed string to search for.' },
      path: { type: 'string', description: 'Project file or directory to search. Defaults to current project.' },
      ignore_case: { type: 'boolean', description: 'Case-insensitive search.' },
      fixed: { type: 'boolean', description: 'Treat pattern as a fixed string.' },
      limit: { type: 'number', description: 'Maximum matching lines to return.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
};

const GLOB_TOOL = {
  type: 'function',
  name: 'Glob',
  description: 'List project files with a bounded glob. Prefer this over shell find/ls.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern such as **/*.js.' },
      path: { type: 'string', description: 'Project directory to search from.' },
      max_depth: { type: 'number', description: 'Optional recursion depth.' },
      limit: { type: 'number', description: 'Maximum paths to return.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
};

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  return tool.name || (tool.function && tool.function.name) || '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nativeToolSchemas() {
  return [clone(READ_TOOL), clone(EDIT_TOOL), clone(GREP_TOOL), clone(GLOB_TOOL)];
}

function nativeToolConfig(cfg) {
  const raw = cfg?.request_transform?.native_tools || cfg?.native_tools || {};
  return { enabled: raw.enabled !== false && process.env.HME_CODEX_NATIVE_TOOLS !== '0' };
}

function injectNativeToolSchemas(body, cfg) {
  if (!nativeToolConfig(cfg).enabled) return { body, stats: { added: 0, dropped: 0, replaced: false, dropped_names: [] } };
  const { body: replaced, stats } = replaceToolsWithUniform(body, cfg);
  return { body: replaced, stats: { added: stats.kept, dropped: stats.dropped, replaced: stats.replaced, dropped_names: stats.dropped_names } };
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch (_e) { return {}; }
}

function bridgeInput(name, args) {
  const file = args.file_path || args.file || '';
  if (name === 'Read') {
    const out = { file_path: file };
    if (args.offset != null) out.offset = Number(args.offset);
    if (args.limit != null) out.limit = Number(args.limit);
    return out;
  }
  if (name === 'Write') {
    return { file_path: file, content: typeof args.content === 'string' ? args.content : '' };
  }
  if (name === 'WebFetch') {
    return { url: String(args.url || ''), prompt: String(args.prompt || '') };
  }
  if (name === 'Agent') {
    const out = { prompt: String(args.prompt || '') };
    if (args.level != null) out.level = Number(args.level);
    return out;
  }
  return {
    file_path: file,
    old_string: args.old_string || '',
    new_string: args.new_string || '',
    ...(args.replace_all ? { replace_all: true } : {}),
  };
}

function jsonHeredoc(input) {
  return `<<'HME_CODEX_JSON'\n${JSON.stringify(input)}\nHME_CODEX_JSON`;
}

const BRIDGE_ACTIONS = { Read: 'read', Edit: 'edit', Write: 'write', WebFetch: 'web_fetch', Agent: 'agent' };

function bridgeCommand(name, args) {
  const action = BRIDGE_ACTIONS[name] || 'read';
  return `${BRIDGE} ${action} --json ${jsonHeredoc(bridgeInput(name, args))}`;
}

function bashCommandArgs(args) {
  const cmd = typeof args.command === 'string' ? args.command : (typeof args.cmd === 'string' ? args.cmd : '');
  const out = { cmd };
  if (args.timeout != null) out.timeout_ms = Number(args.timeout);
  if (args.run_in_background) out.run_in_background = true;
  if (typeof args.description === 'string' && args.description) out.justification = args.description;
  return out;
}

function webSearchArgs(args) {
  const out = { query: String(args.query || '') };
  if (Array.isArray(args.allowed_domains) && args.allowed_domains.length) out.allowed_domains = args.allowed_domains.map(String);
  if (Array.isArray(args.blocked_domains) && args.blocked_domains.length) out.blocked_domains = args.blocked_domains.map(String);
  return out;
}

function callName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.name === 'string') return obj.name;
  if (obj.function && typeof obj.function.name === 'string') return obj.function.name;
  return '';
}

function argsText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (obj.arguments != null) return obj.arguments;
  if (obj.function && obj.function.arguments != null) return obj.function.arguments;
  return '';
}

function setCallArgs(obj, name, args) {
  const next = { ...obj };
  if (typeof next.name === 'string') next.name = name;
  if (next.function && typeof next.function === 'object') {
    next.function = { ...next.function, name, arguments: args };
  }
  if (Object.prototype.hasOwnProperty.call(next, 'arguments')) next.arguments = args;
  return next;
}

function policyCommandArgs(args) {
  const cmd = args.cmd || args.command || '';
  if (!cmd) return args;
  const verdict = evaluateBashInput({ command: cmd }, { supportsRunInBackground: false });
  if (!verdict || verdict.decision === 'allow' && !verdict.changed) return args;
  if (verdict.decision === 'deny') return { ...args, cmd: blockedCommand(verdict.reason) };
  return { ...args, cmd: verdict.input.command || cmd };
}

function rewriteCallObject(obj, stats) {
  const name = callName(obj);
  const isNative = name === TARGET_TOOL || name === 'functions.exec_command';
  if (!BRIDGE_NAMES.has(name) && !RENAME_TARGETS[name] && !isNative) return obj;
  const args = parseArgs(argsText(obj));
  if (BRIDGE_NAMES.has(name)) {
    let cmd = bridgeCommand(name, args);
    if (name === 'Read') {
      const readVerdict = evaluateReadInput(bridgeInput(name, args));
      if (readVerdict.decision === 'deny') cmd = blockedCommand(readVerdict.reason);
    }
    const commandArgs = JSON.stringify(policyCommandArgs({ cmd }));
    stats.calls += 1;
    return setCallArgs(obj, TARGET_TOOL, commandArgs);
  }
  if (name === 'Bash') {
    const commandArgs = JSON.stringify(policyCommandArgs(bashCommandArgs(args)));
    stats.calls += 1;
    return setCallArgs(obj, TARGET_TOOL, commandArgs);
  }
  if (name === 'WebSearch') {
    stats.calls += 1;
    return setCallArgs(obj, WEB_SEARCH_TOOL, JSON.stringify(webSearchArgs(args)));
  }
  const nextArgs = policyCommandArgs(args);
  if (JSON.stringify(nextArgs) === JSON.stringify(args)) return obj;
  stats.calls += 1;
  return setCallArgs(obj, TARGET_TOOL, JSON.stringify(nextArgs));
}

function rewriteValue(value, stats) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, stats));
  const prelim = rewriteCallObject(value, stats);
  const out = {};
  for (const [key, child] of Object.entries(prelim)) out[key] = rewriteValue(child, stats);
  return out;
}

function rewriteCodexResponseObject(obj) {
  const stats = { calls: 0 };
  return { body: rewriteValue(obj, stats), stats };
}

function serializeSse(lines, data) {
  const prefix = lines.filter((line) => !line.startsWith('data:'));
  return `${prefix.join('\n')}${prefix.length ? '\n' : ''}data: ${JSON.stringify(data)}\n\n`;
}

function rewriteSseEvent(raw, stats) {
  const lines = raw.split(/\r?\n/);
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return `${raw}\n\n`;
  const text = dataLines.join('\n');
  if (text === '[DONE]') return `${raw}\n\n`;
  let parsed;
  try { parsed = JSON.parse(text); } catch (_e) { return `${raw}\n\n`; }
  const rewritten = rewriteCodexResponseObject(parsed);
  stats.calls += rewritten.stats.calls;
  return rewritten.stats.calls ? serializeSse(lines, rewritten.body) : `${raw}\n\n`;
}

function createNativeToolSseRewriter() {
  let buffer = '';
  const stats = { calls: 0 };
  return {
    stats,
    feed(chunk) {
      buffer += chunk.toString('utf8');
      let out = '';
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        out += rewriteSseEvent(raw, stats);
      }
      return out;
    },
    finish() {
      const tail = buffer;
      buffer = '';
      return tail;
    },
  };
}

module.exports = {
  injectNativeToolSchemas,
  rewriteCodexResponseObject,
  createNativeToolSseRewriter,
  bridgeCommand,
  nativeToolSchemas,
};
