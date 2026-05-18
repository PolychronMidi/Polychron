'use strict';
// Rewrite Write content with comment-ellipsis stub placeholders.

const _STUB_VERBS = ['exi' + 'sting', 're' + 'st of', 'pre' + 'vious'].join('|');
const _STUB_OBJECTS = ['c' + 'ode', 'f' + 'ile', 'imple' + 'mentation', 'co' + 'ntent', 'fun' + 'ctions?'].join('|');
const PATTERN_A = new RegExp(
  '(#|//|/\\*)\\s*(\\.\\.\\.)??\\s*(' + _STUB_VERBS + ')\\s+(' + _STUB_OBJECTS + ')\\s*(\\.\\.\\.)?',
  'i'
);
const PATTERN_B = new RegExp('\\.\\.\\. ' + 're' + 'st of (' + 'fi' + 'le|imp' + 'lementation|c' + 'ode)');

function _scanAndStrip(content) {
  if (!content) return null;
  const lines = content.split('\n');
  const removed = [];
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN_A.test(lines[i]) || PATTERN_B.test(lines[i])) {
      removed.push(i + 1);
      continue;
    }
    kept.push(lines[i]);
  }
  if (!removed.length) return null;
  return { content: kept.join('\n'), removed };
}

module.exports = {
  name: 'block-comment-ellipsis-stub',
  description: 'Rewrite Write content containing comment-ellipsis stub placeholders.',
  category: 'security',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    let payload = typeof ti.content === 'string' ? ti.content : (typeof ti.new_string === 'string' ? ti.new_string : '');
    if (!payload && Array.isArray(ti.edits)) {
      payload = ti.edits.map((e) => (e && e.new_string) || '').join('\n');
    }
    if (!payload) return ctx.allow();
    const hit = _scanAndStrip(payload);
    if (!hit) return ctx.allow();
    const updated = { ...ti };
    if ('content' in ti && typeof ti.content === 'string') updated.content = hit.content;
    if ('new_string' in ti && typeof ti.new_string === 'string') updated.new_string = hit.content;
    if (Array.isArray(ti.edits)) {
      updated.edits = ti.edits.map((e) => {
        if (!e || typeof e.new_string !== 'string') return e;
        const sub = _scanAndStrip(e.new_string);
        return sub ? { ...e, new_string: sub.content } : e;
      });
    }
    return ctx.rewrite(updated, `DDoC stripped: ellipsis stub - lines [${hit.removed.join(',')}] removed; if elision intended, write COMPLETE file or use Edit`);
  },
};
