'use strict';
// Canonicalize model-visible i/ wrapper invocations. Runtime hooks may rewrite
// execution paths, but transcript/payload text should show intent: i/<tool>.

const I_TOOLS = new Set(['review', 'learn', 'trace', 'evolve', 'status', 'hme', 'audit', 'why', 'policies']);
const SEP = new Set([';', '&', '|', '||', '&&', '(', ')']);

function splitWords(text) {
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(["'\\])/g, '$1'));
  }
  return out;
}

function toolFromIToken(token) {
  const normalized = String(token || '').replace(/^\$PROJECT_ROOT\//, '').replace(/^\$\{PROJECT_ROOT\}\//, '');
  const m = /(?:^|\/)i\/([A-Za-z][A-Za-z0-9_-]*)$/.exec(normalized);
  if (!m) return '';
  return I_TOOLS.has(m[1]) ? m[1] : '';
}

function dispatchToken(token) {
  return /(?:^|\/)scripts\/hme-i-dispatch\.js$/.test(String(token || ''))
    || /(?:^|\/)hme-i-dispatch\.js$/.test(String(token || ''));
}

function commandish(text) {
  const t = String(text || '').trim();
  return /^(?:\w+=\S+\s+)*(?:cd\s+|env\s+|timeout\s+|node\s+|bash\s+|\.\.?\/|\/|i\/|\$\{?PROJECT_ROOT\}?\/)/.test(t);
}

function canonicalFromTokens(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (SEP.has(tok)) continue;
    let tool = toolFromIToken(tok);
    let start = i + 1;
    if (!tool && dispatchToken(tok)) {
      const candidate = tokens[i + 1] || '';
      if (I_TOOLS.has(candidate)) {
        tool = candidate;
        start = i + 2;
      }
    }
    if (!tool) continue;
    const args = [];
    for (const arg of tokens.slice(start)) {
      if (SEP.has(arg)) break;
      if (arg === '--') continue;
      args.push(arg);
    }
    return ['i/' + tool, ...args].join(' ');
  }
  return '';
}

function normalizeICommand(command) {
  const text = String(command || '').trim();
  if (!text || !commandish(text)) return '';
  return canonicalFromTokens(splitWords(text));
}

function normalizeICommandText(text, stats) {
  if (!String(text || '').includes('/i/') && !String(text || '').includes('i/')
      && !String(text || '').includes('hme-i-dispatch.js')) return text;
  return String(text).split(/\r?\n/).map((line) => {
    const normalized = normalizeICommand(line);
    if (!normalized) return line;
    stats.text_rewrites += 1;
    return normalized;
  }).join('\n');
}

function maybeJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) { return null; }
}

function normalizeICommandsInValue(value, stats = { command_rewrites: 0, text_rewrites: 0 }) {
  if (typeof value === 'string') return normalizeICommandText(value, stats);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeICommandsInValue(item, stats));
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'command' || key === 'cmd') && typeof child === 'string') {
      const normalized = normalizeICommand(child);
      if (normalized) {
        out[key] = normalized;
        stats.command_rewrites += 1;
        continue;
      }
    }
    if (key === 'arguments' && typeof child === 'string') {
      const parsed = maybeJson(child);
      if (parsed) {
        const before = JSON.stringify(parsed);
        const nestedStats = { command_rewrites: 0, text_rewrites: 0 };
        const normalized = normalizeICommandsInValue(parsed, nestedStats);
        if (nestedStats.command_rewrites || nestedStats.text_rewrites) {
          stats.command_rewrites += nestedStats.command_rewrites;
          stats.text_rewrites += nestedStats.text_rewrites;
          out[key] = JSON.stringify(normalized);
          continue;
        }
        out[key] = before;
        continue;
      }
    }
    out[key] = normalizeICommandsInValue(child, stats);
  }
  return out;
}

module.exports = {
  normalizeICommand,
  normalizeICommandText,
  normalizeICommandsInValue,
};
