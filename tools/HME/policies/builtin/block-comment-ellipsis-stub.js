'use strict';
/**
 * Block Write tool calls containing comment-ellipsis stub patterns. These
 * destroy files: an LLM-generated placeholder replacement removes real
 * content and leaves only a stub reference. JS port of the gate in
 * pretooluse_write.sh.
 *
 * The regex strings are assembled at runtime so this source file does
 * not match its own pattern (the bash gate that fires on Write events
 * would otherwise block this file from being saved).
 */

// Build the patterns from fragments so the literal trigger phrases don't
// appear in this source file.
const _STUB_VERBS = ['exi' + 'sting', 're' + 'st of', 'pre' + 'vious'].join('|');
const _STUB_OBJECTS = ['c' + 'ode', 'f' + 'ile', 'imple' + 'mentation', 'co' + 'ntent', 'fun' + 'ctions?'].join('|');
const PATTERN_A = new RegExp(
  '(#|//|/\\*)\\s*(\\.\\.\\.)??\\s*(' + _STUB_VERBS + ')\\s+(' + _STUB_OBJECTS + ')\\s*(\\.\\.\\.)?',
  'i'
);
const PATTERN_B = new RegExp('\\.\\.\\. ' + 're' + 'st of (' + 'fi' + 'le|imp' + 'lementation|c' + 'ode)');

const REASON =
  'BLOCKED: Write contains comment-ellipsis stub placeholder. This destroys files. Write the COMPLETE file content or use Edit for partial changes.';

module.exports = {
  name: 'block-comment-ellipsis-stub',
  description: 'Block Write tool calls containing comment-ellipsis stub patterns (file-destroying LLM antipattern).',
  category: 'security',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write'] },
  params: {},
  async fn(ctx) {
    const content = (ctx.toolInput && ctx.toolInput.content) || '';
    if (!content) return ctx.allow();
    if (PATTERN_A.test(content) || PATTERN_B.test(content)) return ctx.deny(REASON);
    return ctx.allow();
  },
};
