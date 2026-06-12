'use strict';
/** Web tool failure-loop guard and activity emission. */

const { textOfToolResult } = require('../tool_result_semantics');

const WEB_TOOLS = new Set(['WebFetch', 'WebSearch', 'web.run', 'web_search', 'search_query']);
const FAIL_RE = /\b(HTTPError|HTTP Error|403|429|5\d\d|timeout|timed out|network error|No search results|Search failed|empty result|no usable result)\b/i;
const OK_RE = /https?:\/\/|\b(source|sources|result|results|title|url)\b/i;
const UA_HINT_RE = /docs\.anthropic\.com|anthropic\.com\/en\/docs/i;
const WINDOW_MS = 10 * 60 * 1000;
const _failures = [];

function _toolName(toolUse) {
  return String((toolUse && toolUse.name) || '');
}

function _isWebTool(toolUse) {
  return WEB_TOOLS.has(_toolName(toolUse));
}

function _target(toolUse) {
  const input = (toolUse && toolUse.input) || {};
  const raw = input.url || input.query || input.q || input.search_query || JSON.stringify(input);
  return String(raw || '').slice(0, 200);
}

function _failed(toolResult) {
  const text = textOfToolResult(toolResult).trim();
  if (toolResult && toolResult.is_error === true) return true;
  if (!text) return true;
  if (FAIL_RE.test(text)) return true;
  if (/^\[SUCCESS\]$/.test(text)) return true;
  return !OK_RE.test(text) && text.length < 80;
}

function _prune(now) {
  while (_failures.length && now - _failures[0].ts > WINDOW_MS) _failures.shift();
}

function _same(a, b) {
  return a.toLowerCase().slice(0, 80) === b.toLowerCase().slice(0, 80);
}

function _countRecent(target, now) {
  _prune(now);
  return _failures.filter((row) => _same(row.target, target)).length;
}

function _guidance(target) {
  const ua = UA_HINT_RE.test(target)
    ? '\nOfficial Anthropic docs fallback: fetch with User-Agent, e.g. `python3 - <<PY` using urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})`.'
    : '';
  return `[HME WEB-FAIL-LOOP] This web lookup failed repeatedly. Stop retrying the same web tool. Diagnose transport/result shape once, then switch to a direct fetch or state the source is unavailable.${ua}`;
}

module.exports = {
  name: 'web_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (!_isWebTool(toolUse)) return;
    const name = _toolName(toolUse);
    const target = _target(toolUse);
    ctx.emit({ event: 'web_tool_call', tool: name, target: target.slice(0, 120) });
    if (!_failed(toolResult)) return;
    const now = Date.now();
    const seen = _countRecent(target, now);
    _failures.push({ ts: now, target });
    ctx.emit({ event: 'web_tool_failure', tool: name, target: target.slice(0, 120), repeat: seen + 1 });
    if (seen < 1 || ctx.hasHmeFooter(toolResult, '[HME WEB-FAIL-LOOP]')) return;
    ctx.appendToResult(toolResult, `\n\n${_guidance(target)}`);
    ctx.markDirty();
  },
};
