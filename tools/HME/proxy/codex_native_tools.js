'use strict';

const { evaluateBashInput } = require('./bash_command_policy');
const { replaceToolsWithUniform, uniformToolList } = require('./codex_uniform_tools');
const { isInvalidEditInput, editToReadFallback } = require('./edit_validation');
const { bridgeCommand: parseBridgeCommand } = require('./codex_tool_text');

const BRIDGE = 'node tools/HME/scripts/codex_structured_tool.js';
const TARGET_TOOL = 'exec_command';
const WEB_SEARCH_TOOL = 'web_search';
const BRIDGE_NAMES = new Set(['Read', 'Edit', 'Write', 'WebFetch', 'Agent']);
const VISIBLE_NAMES = new Set(['Agent', 'Bash', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Write']);
const KNOWN_PASSTHROUGH = new Set([TARGET_TOOL, 'functions.exec_command', WEB_SEARCH_TOOL]);

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  return tool.name || (tool.function && tool.function.name) || '';
}

function nativeToolSchemas() {
  return uniformToolList();
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
    if (args.pages != null) out.pages = String(args.pages);
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

function bashVisibleArgs(args) {
  const command = typeof args.command === 'string' ? args.command : (typeof args.cmd === 'string' ? args.cmd : '');
  const out = { command };
  const timeout = args.timeout != null ? args.timeout : args.timeout_ms;
  if (timeout != null) out.timeout = Number(timeout);
  if (args.run_in_background) out.run_in_background = true;
  const description = args.description || args.justification;
  if (typeof description === 'string' && description) out.description = description;
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
  if (next.function && typeof next.function === 'object') next.function = { ...next.function, name, arguments: args };
  if (Object.prototype.hasOwnProperty.call(next, 'arguments')) next.arguments = args;
  return next;
}

function sameCall(obj, name, input) {
  return callName(obj) === name && String(argsText(obj) || '') === JSON.stringify(input);
}

function visibleCall(obj, stats, name, input, force = false) {
  if (!force && sameCall(obj, name, input)) return obj;
  stats.calls += 1;
  return setCallArgs(obj, name, JSON.stringify(input));
}

function bridgeAsVisible(cmd) {
  const bridge = parseBridgeCommand(cmd);
  return bridge && VISIBLE_NAMES.has(bridge.tool) ? bridge : null;
}

function bashAfterPolicy(args) {
  const original = bashVisibleArgs(args);
  const verdict = evaluateBashInput(original, { supportsRunInBackground: false });
  if (!verdict) return original;
  if (verdict.decision === 'deny') return { ...original, command: `printf %s\\n '${String(verdict.reason || 'blocked').replace(/'/g, `'\\''`)}' >&2; exit 2` };
  return verdict.input ? bashVisibleArgs(verdict.input) : original;
}

function rewriteBridgeName(obj, name, args, stats) {
  let effectiveName = name;
  let effectiveArgs = args;
  if ((name === 'Edit' || name === 'MultiEdit') && isInvalidEditInput(args, { checkFs: true })) {
    effectiveName = 'Read';
    effectiveArgs = editToReadFallback(args);
    stats.edit_fallback_to_read = (stats.edit_fallback_to_read || 0) + 1;
  }
  return visibleCall(obj, stats, effectiveName, bridgeInput(effectiveName, effectiveArgs), effectiveName !== name);
}

function rewriteBash(obj, args, stats, force = false) {
  const next = bashAfterPolicy(args);
  const bridge = bridgeAsVisible(next.command || '');
  if (bridge) return visibleCall(obj, stats, bridge.tool, bridge.input, true);
  return visibleCall(obj, stats, 'Bash', next, force);
}

function rewriteExecCommand(obj, args, stats) {
  const cmd = typeof args.cmd === 'string' ? args.cmd : (typeof args.command === 'string' ? args.command : '');
  const bridge = bridgeAsVisible(cmd);
  if (bridge) return visibleCall(obj, stats, bridge.tool, bridge.input, true);
  return rewriteBash(obj, args, stats, true);
}

function rewriteCallObject(obj, stats) {
  const name = callName(obj);
  const args = parseArgs(argsText(obj));
  if (BRIDGE_NAMES.has(name)) return rewriteBridgeName(obj, name, args, stats);
  if (name === 'Bash') return rewriteBash(obj, args, stats);
  if (name === 'WebSearch' || name === WEB_SEARCH_TOOL) return visibleCall(obj, stats, 'WebSearch', webSearchArgs(args), name === WEB_SEARCH_TOOL);
  if (name === TARGET_TOOL || name === 'functions.exec_command') return rewriteExecCommand(obj, args, stats);
  if (name && obj.type === 'function_call' && !KNOWN_PASSTHROUGH.has(name)) {
    stats.unknown_calls = (stats.unknown_calls || 0) + 1;
    stats.unknown_names = stats.unknown_names || [];
    if (stats.unknown_names.length < 16 && !stats.unknown_names.includes(name)) stats.unknown_names.push(name);
  }
  return obj;
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
  if (rewritten.stats.unknown_calls) {
    stats.unknown_calls = (stats.unknown_calls || 0) + rewritten.stats.unknown_calls;
    stats.unknown_names = stats.unknown_names || [];
    for (const n of rewritten.stats.unknown_names || []) {
      if (stats.unknown_names.length < 16 && !stats.unknown_names.includes(n)) stats.unknown_names.push(n);
    }
  }
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
