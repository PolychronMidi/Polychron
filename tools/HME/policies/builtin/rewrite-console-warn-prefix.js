'use strict';
// Rewrite (was: block) Write/Edit content with bare console.warn calls.
// Auto-prepend the required "Acceptable warning: " prefix to the first
// string argument so the call satisfies the project warn-prefix rule
// without forcing a model retry.

const PATTERN = /\bconsole\.warn\s*\(\s*(['"`])(?!Acceptable warning:)([^'"`]*?)\1/g;

function _rewrite(content) {
  if (typeof content !== 'string' || !content) return null;
  let hits = 0;
  const next = content.replace(PATTERN, (_match, quote, body) => {
    hits += 1;
    return `console.warn(${quote}Acceptable warning: ${body}${quote}`;
  });
  if (!hits) return null;
  return { content: next, hits };
}

function _rewriteToolInput(ti, fn) {
  const out = { ...ti };
  let any = false;
  let lastHit = null;
  if (typeof ti.content === 'string') {
    const r = fn(ti.content);
    if (r) { out.content = r.content; lastHit = r; any = true; }
  }
  if (typeof ti.new_string === 'string') {
    const r = fn(ti.new_string);
    if (r) { out.new_string = r.content; lastHit = r; any = true; }
  }
  if (Array.isArray(ti.edits)) {
    let editAny = false;
    const newEdits = ti.edits.map((e) => {
      if (!e || typeof e.new_string !== 'string') return e;
      const r = fn(e.new_string);
      if (!r) return e;
      editAny = true; lastHit = r;
      return { ...e, new_string: r.content };
    });
    if (editAny) { out.edits = newEdits; any = true; }
  }
  return any ? { input: out, hits: lastHit ? lastHit.hits : 0 } : null;
}

module.exports = {
  name: 'rewrite-console-warn-prefix',
  description: 'Rewrite Write/Edit content with bare console.warn() to use the required "Acceptable warning:" prefix.',
  category: 'style',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    const fp = String(ti.file_path || '');
    if (!/\.(js|ts|tsx|mjs|cjs|jsx)$/.test(fp)) return ctx.allow();
    const result = _rewriteToolInput(ti, _rewrite);
    if (!result) return ctx.allow();
    return ctx.rewrite(result.input, `DDoC stripped: console.warn auto-prefixed with "Acceptable warning:" (${result.hits} call${result.hits === 1 ? '' : 's'})`);
  },
};
