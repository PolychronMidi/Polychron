'use strict';

const BRIDGE_JSON_HEREDOC_RE = /\b(?:node\s+)?(?:\.\/)?(?:[^\s]+\/)?codex_structured_tool\.js\s+(read|edit)\s+--json\s+<<['\"]?([A-Za-z0-9_:-]+)['\"]?\n([\s\S]*?)\n\2/g;

const JSON_HEREDOC_RE = /\b(?:node\s+)?(?:\.\/)?(?:\S*\/)?codex_structured_tool\.js\s+(?:read|edit)\s+--json\s+<<['"]?([A-Za-z0-9_:-]+)['"]?\n[\s\S]*?\n\1/g;

// Normalize internal Codex fallback bridge calls so model-visible history reads
// like native Read/Edit tool use, not like shelling out to a helper script.

const JSON_HEREDOC_RE = /\b(?:node\s+)?(?:\.\/)?(?:[^\s\n]*\/)?codex_structured_tool\.js\s+(?:read|edit)\s+--json\s+<<['"]?[A-Za-z0-9_:-]+['"]?\n[\s\S]*?\n[A-Za-z0-9_:-]+/g;

const JSON_HEREDOC_RE = /\b(?:node\s+)?(?:\S+\/)?codex_structured_tool\.js\s+(?:read|edit)\s+--json\s+<<['"]?([A-Za-z0-9_:-]+)['"]?\n[\s\S]*?\n\1(?=\s|$)/g;

function splitWords(text) {
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(["'\\])/g, '$1'));
  }
  return out;
}

function kvArgs(tokens) {
  const kv = {};
  const pos = [];
  for (const token of tokens) {
    if (!token || token === '--') continue;
    if (/^(;|&&|\|\||\||\))$/.test(token)) break;
    const idx = token.indexOf('=');
    if (idx > 0) kv[token.slice(0, idx).replaceAll('-', '_')] = token.slice(idx + 1);
    else if (!token.startsWith('-')) pos.push(token);
  }
  return { kv, pos };
}

function bridgeFromTokens(tokens) {
  const idx = tokens.findIndex((t) => /(^|\/)codex_structured_tool\.js$/.test(t));
  if (idx < 0) return null;
  const action = tokens[idx + 1];
  if (action !== 'read' && action !== 'edit') return null;
  const { kv, pos } = kvArgs(tokens.slice(idx + 2));
  const file = kv.file_path || kv.file || pos[0] || '';
  const input = file ? { file_path: file } : {};
  if (action === 'read') {
    if (kv.offset !== undefined) input.offset = Number(kv.offset);
    if (kv.limit !== undefined) input.limit = Number(kv.limit);
    return { tool: 'Read', input };
  }
  input.old_string = '<omitted by proxy>';
  input.new_string = '<omitted by proxy>';
  return { tool: 'Edit', input };
}

function bridgeFromJsonCommand(text) {
  const src = String(text || '');
  const m = /codex_structured_tool\.js\s+(read|edit)\s+--json\s+<<['\"]?([A-Za-z0-9_:-]+)['\"]?\n([\s\S]*?)\n\2(?:\s|$)/.exec(src);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[3]); } catch (_e) { return null; }
  const input = { file_path: data.file_path || data.file || '' };
  if (m[1] === 'read') {
    if (data.offset !== undefined) input.offset = Number(data.offset);
    if (data.limit !== undefined) input.limit = Number(data.limit);
    return { tool: 'Read', input };
  }
  input.old_string = '<omitted by proxy>';
  input.new_string = '<omitted by proxy>';
  return { tool: 'Edit', input };
}

function bridgeCommand(text) {
  if (!String(text || '').includes('codex_structured_tool.js')) return null;
  return bridgeFromJsonCommand(text) || bridgeFromTokens(splitWords(text));
}

function displayCall(bridge) {
  return `${bridge.tool}(${JSON.stringify(bridge.input)})`;
}

function maybeJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function rewriteArgumentString(value, bridge) {
  return maybeJson(value) ? JSON.stringify(bridge.input) : displayCall(bridge);
}

function commandFromObject(obj) {
  for (const key of ['cmd', 'command']) {
    if (typeof obj[key] === 'string') {
      const hit = bridgeCommand(obj[key]);
      if (hit) return { key, hit };
    }
  }
  if (typeof obj.arguments === 'string') {
    const parsed = maybeJson(obj.arguments);
    if (parsed) {
      const nested = commandFromObject(parsed);
      if (nested) return { key: 'arguments', hit: nested.hit };
    }
    const hit = bridgeCommand(obj.arguments);
    if (hit) return { key: 'arguments', hit };
  }
  return null;
}

function rewriteLine(line, stats) {
  const hit = bridgeCommand(line);
  if (!hit) return line;
  stats.text_rewrites += 1;
  return displayCall(hit);
}

function rewriteText(text, stats) {
  if (!String(text || '').includes('codex_structured_tool.js')) return text;
  const replaced = String(text).replace(BRIDGE_JSON_HEREDOC_RE, (full) => {
    const hit = bridgeFromJsonCommand(full);
    if (!hit) return full;
    stats.text_rewrites += 1;
    return displayCall(hit);
  });
  return replaced.split(/\r?\n/).map((line) => rewriteLine(line, stats)).join('\n');
}

function normalizeValue(value, stats) {
  if (typeof value === 'string') return rewriteText(value, stats);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, stats));

  const found = commandFromObject(value);
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = normalizeValue(child, stats);
  if (!found) return out;

  stats.call_rewrites += 1;
  const bridge = found.hit;
  if (typeof out.name === 'string') out.name = bridge.tool;
  if (typeof out.tool_name === 'string') out.tool_name = bridge.tool;
  if (typeof out.arguments === 'string') out.arguments = JSON.stringify(bridge.input);
  if (out.input && typeof out.input === 'object' && !Array.isArray(out.input)) out.input = bridge.input;
  if (typeof out.cmd === 'string') out.cmd = displayCall(bridge);
  if (typeof out.command === 'string') out.command = displayCall(bridge);
  return out;
}

function normalizeStructuredBridgeCalls(body) {
  const stats = { call_rewrites: 0, text_rewrites: 0 };
  return { body: normalizeValue(body, stats), stats };
}

module.exports = { bridgeCommand, displayCall, normalizeStructuredBridgeCalls };
