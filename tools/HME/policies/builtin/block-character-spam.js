'use strict';
// Rewrite (was: block) Write/Edit content containing 4+ identical decoration chars.
// Strips the offending runs in-place. Per-line opt-out via the literal token `spam-ok`.

const PATTERN = /([^\w\s()\[\]{}])\1{3,}/g;
const ALLOW_TOKEN = 'spam-ok';

function _scanAndStrip(content) {
  if (!content) return null;
  const lines = content.split('\n');
  const firstHits = [];
  let mutated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_TOKEN)) continue;
    if (!PATTERN.test(line)) { PATTERN.lastIndex = 0; continue; }
    PATTERN.lastIndex = 0;
    let next = line;
    let local;
    while ((local = PATTERN.exec(next)) !== null) {
      if (firstHits.length < 3) firstHits.push(local[1]);
      next = next.slice(0, local.index) + next.slice(local.index + local[0].length);
      PATTERN.lastIndex = 0;
    }
    lines[i] = next;
    mutated = true;
  }
  if (!mutated) return null;
  return { content: lines.join('\n'), firstHits };
}

function _rewriteInput(toolInput, hit) {
  const out = { ...toolInput };
  if ('content' in toolInput && typeof toolInput.content === 'string') out.content = hit.content;
  if ('new_string' in toolInput && typeof toolInput.new_string === 'string') out.new_string = hit.content;
  if (Array.isArray(toolInput.edits)) {
    out.edits = toolInput.edits.map((e) => (e && typeof e.new_string === 'string') ? { ...e, new_string: hit.content } : e);
  }
  return out;
}

module.exports = {
  name: 'block-character-spam',
  description: 'Rewrite Write/Edit content containing 4+ identical decoration characters (strip runs in place).',
  category: 'style',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    let payload = ti.content || ti.new_string || '';
    if (!payload && Array.isArray(ti.edits)) {
      payload = ti.edits.map((e) => (e && e.new_string) || '').join('\n');
    }
    const hit = _scanAndStrip(payload);
    if (!hit) return ctx.allow();
    const sample = hit.firstHits.map((c) => JSON.stringify(c)).join(',');
    return ctx.rewrite(_rewriteInput(ti, hit), `DDoC stripped: char spam(${sample})`);
  },
};
