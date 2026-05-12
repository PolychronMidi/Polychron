'use strict';
// Block Edit/Write content with 3+ consecutive non-annotation comment lines.
// Annotation prefixes (# rationale:, # silent-ok:, # TODO:, etc.) reset the
// counter. Enforces CLAUDE.md: "Inline comments single-line and terse.
// Elaboration goes in doc/."

const THRESHOLD = 3;
const LONG_LINE = 90;

const ANNOTATIONS = [
  '# rationale:', '# silent-ok:', '# TODO:', '# FIXME:',
  '# noqa', '# pylint:', '# pyright:', '# type:',
  '// rationale:', '// silent-ok:', '// TODO:', '// FIXME:',
  '// eslint-', '// noqa',
];

function _commentPrefix(fp) {
  if (!fp) return null;
  const lower = fp.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.jsx') ||
      lower.endsWith('.tsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return '//';
  }
  if (lower.endsWith('.py') || lower.endsWith('.sh') || lower.endsWith('.bash') ||
      lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.toml')) {
    return '#';
  }
  return null;
}

function _startsWithAnnotation(line) {
  const s = line.trimStart();
  return ANNOTATIONS.some((a) => s.startsWith(a));
}

function _scan(fp, content) {
  const prefix = _commentPrefix(fp);
  if (!prefix || !content) return null;
  const lines = content.split('\n');
  let run = 0;
  for (const ln of lines) {
    const s = ln.trimStart();
    if (!s.startsWith(prefix) || s.startsWith('#!')) {
      run = 0;
      continue;
    }
    if (ln.length >= LONG_LINE) return { type: 'LONG', len: ln.length };
    if (_startsWithAnnotation(s)) {
      run = 0;
    } else {
      run += 1;
      if (run >= THRESHOLD) return { type: 'BLOCK', count: run };
    }
  }
  return null;
}

const REASON =
  'BLOCKED: Edit new_string contains a {COUNT}-line consecutive inline-comment block. ' +
  'CLAUDE.md: "Inline comments single-line and terse. Elaboration goes in doc/." ' +
  'Trim to <=2 lines OR move the prose into doc/. Annotation prefixes ' +
  '(# rationale:, # silent-ok:, // rationale:, etc.) reset the counter.';

const REASON_LONG =
  'BLOCKED: Edit new_string contains a comment line of {LEN} chars (>= {LIMIT} char limit). ' +
  'CLAUDE.md: "Inline comments single-line and terse. Elaboration goes in doc/." ' +
  'Long rationale lines belong in doc/.';

module.exports = {
  name: 'block-comment-bloat',
  description: 'Block Edit/Write content with 3+ consecutive non-annotation inline-comment lines.',
  category: 'style',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Edit', 'Write', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    const fp = ti.file_path || '';
    let content = ti.new_string || '';
    if (!content && Array.isArray(ti.edits)) {
      content = ti.edits.map((e) => (e && e.new_string) || '').join('\n');
    }
    const hit = _scan(fp, content);
    if (!hit) return ctx.allow();
    if (hit.type === 'LONG') {
      return ctx.deny(REASON_LONG.replace('{LEN}', hit.len).replace('{LIMIT}', LONG_LINE));
    }
    return ctx.deny(REASON.replace('{COUNT}', hit.count));
  },
};
