'use strict';
/**
 * Block Write tool calls whose content matches credential-like patterns
 * (api_key=<long-string>, password=<long-string>, etc.). Complements
 * block-secrets-write (filename-based) — this one catches the case where
 * the FILENAME is innocuous but the CONTENT is a credential.
 *
 * JS port of the secret-pattern detector in pretooluse_write.sh.
 */

const PATTERN = /(api[_-]?key|password|secret|token)[\s]*[:=][\s]*[A-Za-z0-9+/]{20,}/i;

module.exports = {
  name: 'block-secret-content-pattern',
  description: 'Block writes whose content contains api_key=/password=/secret=/token= followed by a long base64-ish string.',
  category: 'security',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write'] },
  params: {},
  async fn(ctx) {
    const content = (ctx.toolInput && ctx.toolInput.content) || '';
    if (!content) return ctx.allow();
    if (PATTERN.test(content)) {
      return ctx.deny('BLOCKED: Potential secret/credential detected in write content. Review before writing.');
    }
    return ctx.allow();
  },
};
