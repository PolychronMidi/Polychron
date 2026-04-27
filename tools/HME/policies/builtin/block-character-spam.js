'use strict';
/**
 * Block Write/Edit tool calls whose content contains 4+ identical
 * non-word, non-whitespace, non-paren/bracket characters in a row —
 * targets visual-decoration spam (runs of dashes, equals, hashes,
 * pipes, tildes, slashes, unicode box-drawing).
 *
 * Word characters, whitespace, and paren/bracket/brace pairs are exempt
 * so identifiers, indentation, and stacked code structure don't trip
 * the rule. Per-line opt-out via the literal token `spam-ok`.
 *
 * Companion to the `repeated-char-spam` HCI verifier: the verifier
 * scans the codebase post-hoc; this policy blocks new spam at write
 * time so existing-clean files stay clean.
 */

const PATTERN = /([^\w\s()\[\]{}])\1{3,}/;
const ALLOW_TOKEN = 'spam-ok';

function _scan(content) {
  if (!content) return null;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_TOKEN)) continue;
    const m = line.match(PATTERN);
    if (m) return { lineNum: i + 1, run: m[0], char: m[1] };
  }
  return null;
}

const REASON_PREFIX =
  'BLOCKED: content contains a run of 4+ identical decoration characters ' +
  '(line {LINE}: {CHAR}×{LEN}). Visual-decoration spam — runs of ' +
  'dashes, equals, hashes, pipes, tildes, slashes, unicode box-drawing — ' +
  'is banned across the project. Use plain text instead of divider bars; ' +
  'normalize markdown table separators to 3 dashes per cell (`| --- |`); ' +
  'demote headings to depth ≤3. If the run is genuinely required (e.g. ' +
  'discussing git conflict markers), append the inline marker `' + ALLOW_TOKEN + '` ' +
  'to that line to opt out.';

function _formatReason(hit) {
  return REASON_PREFIX
    .replace('{LINE}', hit.lineNum)
    .replace('{CHAR}', JSON.stringify(hit.char))
    .replace('{LEN}', hit.run.length);
}

module.exports = {
  name: 'block-character-spam',
  description:
    'Block Write/Edit content containing 4+ identical decoration characters in a row.',
  category: 'style',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    // Write: { content }. Edit: { new_string }. MultiEdit: { edits: [{new_string, ...}] }.
    let payload = ti.content || ti.new_string || '';
    if (!payload && Array.isArray(ti.edits)) {
      payload = ti.edits.map((e) => (e && e.new_string) || '').join('\n');
    }
    const hit = _scan(payload);
    if (hit) return ctx.deny(_formatReason(hit));
    return ctx.allow();
  },
};
