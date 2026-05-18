'use strict';
// Rewrite (was: block) Python Write/Edit content with naked `except ...: pass`
// blocks. Auto-append a `# silent-ok: pending review` marker to the pass
// line so CONSTITUTION rule 3 is satisfied without a model retry. The
// placeholder signals to the model that a real reason should replace
// "pending review" -- or the silence should be removed.

const PATTERN = /(except[^:\n]*:\s*\n[ \t]*pass)\b(?![^\n]*silent-ok)/g;

function _rewrite(content) {
  if (typeof content !== 'string' || !content) return null;
  let hits = 0;
  const next = content.replace(PATTERN, (match) => {
    hits += 1;
    return `${match}  # silent-ok: pending review`;
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
  name: 'rewrite-except-pass-silent-ok',
  description: 'Rewrite Python Write/Edit content with naked `except: pass` to include a `# silent-ok: pending review` annotation.',
  category: 'style',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    const fp = String(ti.file_path || '');
    if (!/\.py$/.test(fp)) return ctx.allow();
    const result = _rewriteToolInput(ti, _rewrite);
    if (!result) return ctx.allow();
    return ctx.rewrite(result.input, `DDoC stripped: except/pass auto-annotated with silent-ok placeholder (${result.hits} block${result.hits === 1 ? '' : 's'}); replace "pending review" with real reason or propagate`);
  },
};
