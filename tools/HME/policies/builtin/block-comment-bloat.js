'use strict';
const { requireEnv: _hmeRequireEnv } = require('../../proxy/shared/load_env.js');
// Rewrite (was: block) content with 3+ consecutive non-annotation comment lines.
// Truncate long comment lines and emit ultra-terse DDoC notes via rewrite envelope.

const THRESHOLD = parseInt(_hmeRequireEnv('COMMENT_BLOAT_WARN'), 10);
const LONG_LINE = parseInt(_hmeRequireEnv('COMMENT_BLOAT_LONG_LINE'), 10);

const _ANNOTATION_TAGS = ['silent-ok:', 'FIX'+'ME:', 'noqa', 'pylint:', 'pyright:', 'type:', 'eslint-'];

function _commentPrefix(fp) {
  if (!fp) return null;
  const lower = fp.toLowerCase();
  if (/\.(?:js|ts|jsx|tsx|mjs|cjs)$/.test(lower)) return '//';
  if (/\.(?:py|sh|bash|yaml|yml|toml)$/.test(lower)) return '#';
  return null;
}

function _startsWithAnnotation(line, prefix) {
  const s = line.trimStart();
  if (!s.startsWith(prefix)) return false;
  const rest = s.slice(prefix.length);
  return _ANNOTATION_TAGS.some((t) => rest.startsWith(t) || rest.startsWith(' ' + t));
}

function _scanAndRewrite(fp, content) {
  const prefix = _commentPrefix(fp);
  if (!prefix || !content) return null;
  const lines = content.split('\n');
  const longTruncs = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const s = ln.trimStart();
    if (!s.startsWith(prefix) || s.startsWith('#!')) continue;
    if (ln.length >= LONG_LINE) {
      const removed = `${LONG_LINE}-${ln.length}`;
      lines[i] = ln.slice(0, LONG_LINE - 1);
      longTruncs.push({ line: i + 1, removed });
    }
  }
  const bloatRemoved = [];
  let run = 0;
  let runStart = -1;
  let isFirstContent = true;
  for (let i = 0; i <= lines.length; i++) {
    const ln = i < lines.length ? lines[i] : '';
    const s = ln.trimStart();
    const isComment = i < lines.length && s.startsWith(prefix) && !s.startsWith('#!');
    if (isComment && !isFirstContent && !_startsWithAnnotation(s, prefix)) {
      if (run === 0) runStart = i;
      run += 1;
    } else {
      if (s && i < lines.length) isFirstContent = false;
      if (run >= THRESHOLD) {
        for (let k = runStart + 2; k < runStart + run; k++) bloatRemoved.push(k + 1);
      }
      run = 0;
      runStart = -1;
    }
  }
  if (bloatRemoved.length === 0 && longTruncs.length === 0) return null;
  const keep = new Set();
  for (let i = 0; i < lines.length; i++) keep.add(i);
  for (const ln of bloatRemoved) keep.delete(ln - 1);
  const kept = [];
  for (let i = 0; i < lines.length; i++) if (keep.has(i)) kept.push(lines[i]);
  const messages = [];
  if (bloatRemoved.length) messages.push(`DDoC stripped: comment_bloat - lines removed: [${bloatRemoved.join(',')}]`);
  for (const lt of longTruncs) messages.push(`DDoC stripped: chars ${lt.removed} removed from line ${lt.line}`);
  return { content: kept.join('\n'), messages };
}

function _rewriteInput(toolInput, fp, hit) {
  const out = { ...toolInput, file_path: fp };
  if ('content' in toolInput && typeof toolInput.content === 'string') out.content = hit.content;
  if ('new_string' in toolInput && typeof toolInput.new_string === 'string') out.new_string = hit.content;
  if (Array.isArray(toolInput.edits)) {
    out.edits = toolInput.edits.map((e) => (e && typeof e.new_string === 'string') ? { ...e, new_string: hit.content } : e);
  }
  return out;
}

module.exports = {
  name: 'block-comment-bloat',
  description: 'Rewrite Edit/Write content with 3+ consecutive non-annotation comment lines (trim/truncate).',
  category: 'style',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Edit', 'Write', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    const fp = ti.file_path || '';
    let content = ti.new_string || ti.content || '';
    if (!content && Array.isArray(ti.edits)) {
      content = ti.edits.map((e) => (e && e.new_string) || '').join('\n');
    }
    const hit = _scanAndRewrite(fp, content);
    if (!hit) return ctx.allow();
    return ctx.rewrite(_rewriteInput(ti, fp, hit), hit.messages.join('\n'));
  },
};
