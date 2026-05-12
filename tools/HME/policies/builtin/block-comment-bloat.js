'use strict';
// Block content with 3+ consecutive non-annotation comment lines. Annotation
// prefixes (rationale, silent-ok, fixme, noqa) reset the counter.

const THRESHOLD = parseInt(process.env.COMMENT_BLOAT_WARN || '3', 10);
const LONG_LINE = parseInt(process.env.COMMENT_BLOAT_LONG_LINE || '90', 10);

const _ANNOTATION_TAGS = ['silent-ok:', 'FIXME:', 'noqa', 'pylint:', 'pyright:', 'type:', 'eslint-'];

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
  let isFirstContent = true;  // file headers at content start are exempt
  for (const ln of lines) {
    const s = ln.trimStart();
    if (!s.startsWith(prefix) || s.startsWith('#!')) {
      if (s) isFirstContent = false;
      run = 0;
      continue;
    }
    if (isFirstContent) continue;  // file header comment
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
