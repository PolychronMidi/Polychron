'use strict';
// Scrub credential-like tool output to <REDACTED:type> before model/context injection.
// Runs early, biases toward false positives, and precompiles narrow secret patterns.

const { blockText } = require('../request_shape');

// Pre-compiled patterns. Each entry: [regex, redacted-marker, friendly-tag].
// anti-fork-begin: secret-sanitizer-patterns min=12
const PATTERNS = [
  // OpenAI / Anthropic / Stripe / GitHub / generic "sk-" provider keys.
  [/\bsk-(?:proj-|ant-|live_|test_)?[A-Za-z0-9_-]{24,}\b/g, '<REDACTED:provider-key>'],
  [/\bgsk_[A-Za-z0-9]{24,}\b/g, '<REDACTED:provider-key>'],
  [/\bgh[opsuar]_[A-Za-z0-9]{30,}\b/g, '<REDACTED:github-token>'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, '<REDACTED:github-pat>'],
  // AWS access keys (AKIA + SECRETKEY format).
  [/\bAKIA[0-9A-Z]{16}\b/g, '<REDACTED:aws-access-key>'],
  // AWS secret access keys (40 chars base64-ish, anchored to common contexts).
  [/aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}/gi, 'aws_secret_access_key=<REDACTED:aws-secret>'],
  // Slack tokens (xox[abposr]-).
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '<REDACTED:slack-token>'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '<REDACTED:google-key>'],
  // Discord bot tokens (3-segment, base64ish).
  [/\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27,}\b/g, '<REDACTED:discord-token>'],

  // JSON Web Tokens -- three-segment base64url separated by dots, header
  // typically begins with eyJ (decoded `{"`).
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<REDACTED:jwt>'],

  // Authorization Bearer headers (HTTP).
  [/\bBearer\s+[A-Za-z0-9._\-+/=]{16,}\b/g, 'Bearer <REDACTED:bearer-token>'],
  // Authorization Basic headers.
  [/\bBasic\s+[A-Za-z0-9+/=]{20,}\b/g, 'Basic <REDACTED:basic-auth>'],

  // PEM private key blocks -- replace the whole block (header to footer).
  // RSA / OPENSSH / EC / DSA / generic "PRIVATE KEY".
  [
    /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----/g,
    '<REDACTED:private-key-block>',
  ],

  // Database connection strings with embedded credentials.
  // postgres://user:password@host, mysql://, mongodb(+srv)://, redis://
  [
    /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|rediss):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi,
    (m) => m.replace(/:\/\/[^@]+@/, '://<REDACTED:db-creds>@'),
  ],
];
// anti-fork-end: secret-sanitizer-patterns

// Substitution markers we ALREADY emit -- used to suppress double-redaction
// across proxy restarts where tool_results re-enter the pipeline.
const REDACTED_MARKER_RE = /<REDACTED:[a-z-]+>/;

// Join inner text blocks with '\n' (not '') so \b word boundaries survive
// across blocks -- shared blockText takes toolResultJoiner for exactly this.
function _textOf(toolResult) {
  return blockText({ type: 'tool_result', content: toolResult && toolResult.content }, { toolResults: true, toolResultJoiner: '\n' });
}

function _scrub(text) {
  let out = text;
  let hits = 0;
  for (const [re, replacement] of PATTERNS) {
    if (typeof replacement === 'function') {
      out = out.replace(re, (...args) => { hits++; return replacement(...args); });
    } else {
      out = out.replace(re, () => { hits++; return replacement; });
    }
  }
  return { text: out, hits };
}

function _writeBack(toolResult, scrubbed) {
  if (typeof toolResult.content === 'string') {
    toolResult.content = scrubbed;
    return;
  }
  if (Array.isArray(toolResult.content)) {
    let written = false;
    for (const block of toolResult.content) {
      if (block && block.type === 'text') {
        if (!written) { block.text = scrubbed; written = true; }
        else { block.text = ''; }
      }
    }
    if (!written) toolResult.content.push({ type: 'text', text: scrubbed });
    return;
  }
  toolResult.content = scrubbed;
}

module.exports = {
  name: 'secret_sanitizer',

  onToolResult({ toolUse, toolResult, ctx }) {
    // Apply to ALL tools, not just Bash -- Read, Grep, web fetches, etc. can
    const text = _textOf(toolResult);
    if (!text) return;
    // Skip if the text already contains our redaction marker (proxy restart
    // re-entry); harmless to scrub again, but we save work.
    if (REDACTED_MARKER_RE.test(text)) {
      const { text: rescrubbed, hits } = _scrub(text);
      if (hits > 0) {
        _writeBack(toolResult, rescrubbed);
        ctx.markDirty();
      }
      return;
    }
    const { text: scrubbed, hits } = _scrub(text);
    if (hits === 0) return;
    _writeBack(toolResult, scrubbed);
    ctx.markDirty();
    ctx.emit({
      event: 'secret_sanitized',
      tool: toolUse.name,
      hits,
    });
  },
};
