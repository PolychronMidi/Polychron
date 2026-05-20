'use strict';
const { requireEnv: _hmeRequireEnv } = require('./shared/load_env.js');

const path = require('path');
const { repairMalformedNativeCall, rewriteBrokenReadDisplays } = require('./codex_tool_display_artifacts');

const PROJECT_ROOT = _hmeRequireEnv('PROJECT_ROOT');
const TARGET_NAMES = new Set(['exec_command', 'functions.exec_command']);
const ACTION_TO_TOOL = {
  read: 'Read',
  edit: 'Edit',
  grep: 'Grep',
  glob: 'Glob',
  write: 'Write',
  web_fetch: 'WebFetch',
  agent: 'Agent',
};
const BARE_TOOL_NAMES = new Set(['Agent', 'Bash', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Write']);
const REDACTED_EDIT = '<display-redacted: original was sent; do not reuse>';
const REDACTED_CONTENT = '<display-redacted: content was sent; do not reuse>';
const SCRIPT_RE = /(?:^|\/)codex_structured_tool\.js$/;
const HEREDOC_RE = /codex_structured_tool\.js\s+([A-Za-z_][A-Za-z0-9_]*)\s+--json\s+<<['"]?([A-Za-z0-9_:-]+)['"]?\r?\n([\s\S]*?)\r?\n\2(?:\s|$)/;

function splitWords(text) {
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(["'\\])/g, '$1'));
  }
  return out;
}

function maybeJson(text) {
  try {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) { return null; }
}

function numberValue(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolValue(value) {
  return value === true || ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function addNumber(out, input, key) {
  const n = numberValue(input[key]);
  if (n != null) out[key] = n;
}

function firstValue(input, keys) {
  for (const key of keys) if (input[key] != null && input[key] !== '') return input[key];
  return '';
}

function invalidPathish(raw) {
  const s = String(raw ?? '').trim();
  return !s || s.startsWith('<<') || /HME_CODEX_JSON|[\r\n{}]/.test(s);
}

function cleanPath(raw) {
  const s = String(raw ?? '').trim().replace(/^[`'"]+|[`'".,;:]+$/g, '');
  return invalidPathish(s) ? '' : s;
}

function shortPath(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const expanded = s.replace(/^\$\{?PROJECT_ROOT\}?\//, '');
  if (!path.isAbsolute(expanded)) return expanded;
  const rel = path.relative(PROJECT_ROOT, expanded);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  return expanded;
}

function isPdfPath(file) {
  return /\.pdf(?:$|[?#])/i.test(String(file || '').trim());
}

function normalizeRead(input) {
  const file = cleanPath(firstValue(input, ['file_path', 'file']) || input._?.[0]);
  if (!file) return null;
  const out = { file_path: file };
  addNumber(out, input, 'offset');
  addNumber(out, input, 'limit');
  addNumber(out, input, 'tail');
  if (input.pages != null && isPdfPath(file)) out.pages = String(input.pages);
  return out;
}

function normalizeEdit(input) {
  const file = cleanPath(firstValue(input, ['file_path', 'file']) || input._?.[0]);
  if (!file) return null;
  const out = { file_path: file };
  if (input.old_string != null || input.old != null || input.old_file != null) out.old_string = REDACTED_EDIT;
  if (input.new_string != null || input.new != null || input.new_file != null) out.new_string = REDACTED_EDIT;
  if (boolValue(input.replace_all)) out.replace_all = true;
  return out;
}

function normalizeWrite(input) {
  const file = cleanPath(firstValue(input, ['file_path', 'file']) || input._?.[0]);
  if (!file) return null;
  const out = { file_path: file };
  if (input.content != null || input.content_file != null) out.content = REDACTED_CONTENT;
  return out;
}

function normalizeGrep(input) {
  const out = { pattern: String(firstValue(input, ['pattern']) || input._?.[0] || '') };
  if (input.path != null || input._?.[1]) out.path = String(input.path || input._?.[1]);
  addNumber(out, input, 'limit');
  if (boolValue(input.ignore_case)) out.ignore_case = true;
  if (boolValue(input.fixed)) out.fixed = true;
  return out.pattern ? out : null;
}

function normalizeGlob(input) {
  const out = { pattern: String(firstValue(input, ['pattern']) || input._?.[0] || '*') };
  if (input.path != null || input._?.[1]) out.path = String(input.path || input._?.[1]);
  addNumber(out, input, 'max_depth');
  addNumber(out, input, 'limit');
  if (input.type != null) out.type = String(input.type);
  return out;
}

function normalizeWebFetch(input) {
  const url = String(input.url || '').trim();
  if (!url) return null;
  const out = { url };
  if (input.prompt != null) out.prompt = String(input.prompt);
  return out;
}

function deriveDescription(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return 'Subagent task';
  const first = text.split(/\r?\n/)[0].trim() || text;
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}...` : first;
}

function normalizeAgent(input) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return null;
  const out = { prompt, description: String(input.description || input.justification || deriveDescription(prompt)) };
  const level = numberValue(input.level);
  if (level != null) out.level = level;
  return out;
}

function normalizeBash(input) {
  const command = String(input.cmd || input.command || '').trim();
  if (!command) return null;
  const out = { command };
  const timeout = numberValue(input.timeout_ms ?? input.timeout);
  if (timeout != null) out.timeout = timeout;
  if (input.run_in_background) out.run_in_background = true;
  const description = input.justification || input.description;
  if (description) out.description = String(description);
  return out;
}

function normalizeInput(action, input) {
  const tool = ACTION_TO_TOOL[action];
  if (!tool || !input || typeof input !== 'object') return null;
  const data = Array.isArray(input) ? { _: input } : input;
  const normalizers = {
    read: normalizeRead,
    edit: normalizeEdit,
    write: normalizeWrite,
    grep: normalizeGrep,
    glob: normalizeGlob,
    web_fetch: normalizeWebFetch,
    agent: normalizeAgent,
  };
  const normalized = normalizers[action](data);
  return normalized ? { tool, input: normalized } : null;
}

function kvArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') continue;
    if (a.startsWith('--')) {
      const key = a.slice(2).replaceAll('-', '_');
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) out[key] = args[++i];
      else out[key] = true;
    } else if (a.includes('=')) {
      const idx = a.indexOf('=');
      out[a.slice(0, idx).replaceAll('-', '_')] = a.slice(idx + 1);
    } else out._.push(a);
  }
  return out;
}

function bridgeFromJsonCommand(src) {
  const m = HEREDOC_RE.exec(src);
  if (!m) return null;
  return normalizeInput(m[1], maybeJson(m[3]));
}

function bridgeFromTokens(tokens) {
  const idx = tokens.findIndex((tok) => SCRIPT_RE.test(String(tok || '')));
  if (idx < 0) return null;
  const action = tokens[idx + 1] || '';
  const args = tokens.slice(idx + 2);
  const jsonIdx = args.indexOf('--json');
  if (jsonIdx >= 0) {
    const payload = args[jsonIdx + 1] || '';
    if (!payload || payload.startsWith('<<') || payload.includes('HME_CODEX_JSON')) return null;
    return normalizeInput(action, maybeJson(payload));
  }
  if (args.some((arg) => String(arg).startsWith('<<') || String(arg).includes('HME_CODEX_JSON'))) return null;
  return normalizeInput(action, kvArgs(args));
}

function smolToolCommand(text) {
  const src = String(text || '').trim();
  if (!src.includes('hme_tools/run_tool.py')) return null;
  const m = /run_tool\.py\s+([A-Za-z][A-Za-z0-9]*)\s+--json\s+<<['"]?([A-Za-z0-9_:-]+)['"]?\r?\n([\s\S]*?)\r?\n\2(?:\s|$)/.exec(src);
  if (!m || !BARE_TOOL_NAMES.has(m[1])) return null;
  const input = maybeJson(m[3]);
  return input ? { tool: m[1], input } : null;
}

function bridgeCommand(text) {
  const src = String(text || '').trim();
  const smol = smolToolCommand(src);
  if (smol) return smol;
  if (!src.includes('codex_structured_tool.js')) return null;
  const jsonHit = bridgeFromJsonCommand(src);
  if (jsonHit) return jsonHit;
  if (/<<['"]?HME_CODEX_JSON/.test(src)) return null;
  return bridgeFromTokens(splitWords(src));
}

function trunc(text, n = 96) {
  const s = String(text || '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function displayRead(input) {
  const file = shortPath(input.file_path);
  if (input.pages) return `Read ${file} pages ${input.pages}`.trim();
  if (Number.isFinite(input.offset) && Number.isFinite(input.limit)) {
    return `Read ${file} lines ${input.offset + 1}-${input.offset + input.limit}`.trim();
  }
  if (Number.isFinite(input.offset)) return `Read ${file} from line ${input.offset + 1}`.trim();
  if (Number.isFinite(input.limit)) return `Read ${file} first ${input.limit} lines`.trim();
  if (Number.isFinite(input.tail)) return `Read ${file} last ${input.tail} lines`.trim();
  return `Read ${file}`.trim();
}

function displayCall(bridge) {
  const input = bridge.input || {};
  if (bridge.tool === 'Read') return displayRead(input);
  if (bridge.tool === 'Edit') return `Edit ${shortPath(input.file_path)}`.trim();
  if (bridge.tool === 'Write') return `Write ${shortPath(input.file_path)}`.trim();
  if (bridge.tool === 'Grep') return `Grep ${JSON.stringify(trunc(input.pattern || ''))} in ${shortPath(input.path || '.')}`;
  if (bridge.tool === 'Glob') return `Glob ${trunc(input.pattern || '*')} in ${shortPath(input.path || '.')}`;
  if (bridge.tool === 'WebFetch') return `WebFetch ${input.url || ''}`.trim();
  if (bridge.tool === 'Agent') return `Agent level=${input.level || 3}`;
  if (bridge.tool === 'Bash') return `Bash ${JSON.stringify(trunc(input.command || ''))}`;
  return `${bridge.tool} ${JSON.stringify(input)}`;
}

function actionToolFromLine(line) {
  const tokens = splitWords(line);
  const idx = tokens.findIndex((tok) => SCRIPT_RE.test(String(tok || '')));
  if (idx >= 0) return ACTION_TO_TOOL[tokens[idx + 1]] || 'Tool';
  const smolIdx = tokens.findIndex((tok) => String(tok || '').endsWith('hme_tools/run_tool.py'));
  return BARE_TOOL_NAMES.has(tokens[smolIdx + 1]) ? tokens[smolIdx + 1] : 'Tool';
}

function heredocMarker(line) {
  const m = /<<['"]?([A-Za-z0-9_:-]+)['"]?/.exec(String(line || ''));
  return m ? m[1] : '';
}

function normalizeText(text, stats) {
  const src = rewriteBrokenReadDisplays(String(text), displayCall, stats);
  if (!src.includes('codex_structured_tool.js') && !src.includes('hme_tools/run_tool.py')) return src;
  const lines = src.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('codex_structured_tool.js') && line.includes('<<')) {
      const marker = heredocMarker(line);
      const block = [line];
      while (marker && i + 1 < lines.length) {
        const next = lines[++i];
        block.push(next);
        if (next.trim() === marker) break;
      }
      const bridge = bridgeCommand(block.join('\n'));
      out.push(bridge ? displayCall(bridge) : actionToolFromLine(line));
      stats.text_rewrites += 1;
      continue;
    }
    const bridge = bridgeCommand(line);
    if (bridge) {
      out.push(displayCall(bridge));
      stats.text_rewrites += 1;
    } else out.push(line);
  }
  return out.join('\n');
}

function callName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.name === 'string') return obj.name;
  if (obj.function && typeof obj.function.name === 'string') return obj.function.name;
  return '';
}

function payloadValue(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(obj, 'arguments')) return obj.arguments;
  if (obj.function && Object.prototype.hasOwnProperty.call(obj.function, 'arguments')) return obj.function.arguments;
  if (obj.input && typeof obj.input === 'object') return obj.input;
  return null;
}

function setCallPayload(obj, name, input) {
  const next = { ...obj };
  const args = JSON.stringify(input);
  if (typeof next.name === 'string') next.name = name;
  if (next.function && typeof next.function === 'object') next.function = { ...next.function, name, arguments: args };
  if (Object.prototype.hasOwnProperty.call(next, 'arguments')) next.arguments = args;
  if (Object.prototype.hasOwnProperty.call(next, 'input')) next.input = input;
  return next;
}

function replacementFromExecCall(obj) {
  if (!TARGET_NAMES.has(callName(obj))) return null;
  const parsed = maybeJson(payloadValue(obj));
  if (!parsed) return null;
  const cmd = typeof parsed.cmd === 'string' ? parsed.cmd : (typeof parsed.command === 'string' ? parsed.command : '');
  const bridge = bridgeCommand(cmd);
  if (bridge) return bridge;
  const bash = normalizeBash(parsed);
  return bash ? { tool: 'Bash', input: bash } : null;
}

function rewriteValue(value, stats) {
  if (typeof value === 'string') return normalizeText(value, stats);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, stats));
  const nativeRepair = repairMalformedNativeCall(callName(value), maybeJson(payloadValue(value)) || payloadValue(value));
  const replacement = nativeRepair || replacementFromExecCall(value);
  if (replacement) {
    stats.call_rewrites += 1;
    return setCallPayload(value, replacement.tool, replacement.input);
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = rewriteValue(child, stats);
  return out;
}

function normalizeStructuredBridgeCalls(value, stats = { call_rewrites: 0, text_rewrites: 0 }) {
  return { body: rewriteValue(value, stats), stats };
}

module.exports = {
  bridgeCommand,
  displayCall,
  normalizeStructuredBridgeCalls,
};
