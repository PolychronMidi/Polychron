'use strict';

const { evaluateBashInput, blockedCommand } = require('./bash_command_policy');
const { evaluateReadInput } = require('./read_policy');

const BRIDGE = 'node tools/HME/scripts/codex_structured_tool.js';
const TARGET_TOOL = 'exec_command';
const NATIVE_NAMES = new Set(['Read', 'Edit']);

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

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  return tool.name || (tool.function && tool.function.name) || '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nativeToolSchemas() {
  return [clone(READ_TOOL), clone(EDIT_TOOL)];
}

function nativeToolConfig(cfg) {
  const raw = cfg?.request_transform?.native_tools || cfg?.native_tools || {};
  return { enabled: raw.enabled !== false && process.env.HME_CODEX_NATIVE_TOOLS !== '0' };
}

function injectNativeToolSchemas(body, cfg) {
  const stats = { added: 0 };
  if (!nativeToolConfig(cfg).enabled) return { body, stats };
  const tools = Array.isArray(body.tools) ? body.tools.slice() : [];
  const names = new Set(tools.map(toolName).filter(Boolean));
  for (const spec of nativeToolSchemas()) {
    if (names.has(spec.name)) continue;
    tools.push(spec);
    names.add(spec.name);
    stats.added += 1;
  }
  return { body: { ...body, tools }, stats };
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
  return {
    file_path: file,
    old_string: args.old_string || '',
    new_string: args.new_string || '',
  };
}

function jsonHeredoc(input) {
  return `<<'HME_CODEX_JSON'\n${JSON.stringify(input)}\nHME_CODEX_JSON`;
}

function bridgeCommand(name, args) {
  const action = name === 'Read' ? 'read' : 'edit';
  return `${BRIDGE} ${action} --json ${jsonHeredoc(bridgeInput(name, args))}`;
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
  const verdict = evaluateBashInput({ command: cmd });
  if (!verdict || verdict.decision === 'allow' && !verdict.changed) return args;
  if (verdict.decision === 'deny') return { ...args, cmd: blockedCommand(verdict.reason) };
  return { ...args, cmd: verdict.input.command || cmd };
}

function rewriteCallObject(obj, stats) {
  const name = callName(obj);
  if (!NATIVE_NAMES.has(name) && name !== TARGET_TOOL && name !== 'functions.exec_command') return obj;
  const args = parseArgs(argsText(obj));
  if (NATIVE_NAMES.has(name)) {
    let cmd = bridgeCommand(name, args);
    if (name === 'Read') {
      const readVerdict = evaluateReadInput(bridgeInput(name, args));
      if (readVerdict.decision === 'deny') cmd = blockedCommand(readVerdict.reason);
    }
    const commandArgs = JSON.stringify(policyCommandArgs({ cmd }));
    stats.calls += 1;
    return setCallArgs(obj, TARGET_TOOL, commandArgs);
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
