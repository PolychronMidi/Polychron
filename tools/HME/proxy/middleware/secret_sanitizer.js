'use strict';
/**
 * Secret sanitizer — scrub credential-like patterns from tool output before
 * the model sees it. Pattern catalog adapted from FailproofAI's
 * sanitize-{api-keys,jwt,bearer-tokens,private-key-content,connection-strings}
 * built-ins. Each match is replaced with a stable marker (`<REDACTED:type>`)
 * so the agent knows a value was scrubbed without seeing the value itself.
 *
 * Why this exists: a single `cat .env`, `printenv`, `git config --list`,
 * `npm config get`, or `env` can leak tokens into the model's context. Once
 * in context, the agent can echo them back, paste them into other tools,
 * commit them, or include them in error reports. Sanitization at the
 * tool_result boundary is the cheapest, most reliable mitigation — far
 * better than relying on training data to suppress leakage.
 *
 * Ordering: runs BEFORE bash_enrichment (which appends [err] footers) and
 * BEFORE every context-injection / KB-summary middleware. The sanitizer
 * sits at the head of post_tool_trace so no other middleware ever sees
 * the unredacted text. Configured in middleware/order.json.
 *
 * Trade-offs taken explicitly:
 *   - We REGEX-MATCH on output text. Real shell sessions can produce
 *     base64ish strings that aren't secrets (build-tool hashes, base64
 *     test fixtures, image data). False positives produce harmless
 *     `<REDACTED>` substitutions; under-detection is the worse failure.
 *     Bias toward false positives.
 *   - The patterns are intentionally narrow at the prefix layer (`sk-`,
 *     `Bearer `, `eyJ` for JWT, `-----BEGIN`) so generic random base64
 *     stays untouched.
 *   - Patterns are pre-compiled at module load (FailproofAI calls this
 *     out as a perf nicety; matches our pattern of hot-path-cheap
 *     middleware).
 */

// Pre-compiled patterns. Each entry: [regex, redacted-marker, friendly-tag].
// anti-fork-begin: secret-sanitizer-patterns min=12
const PATTERNS = [
  // OpenAI / Anthropic / Stripe / GitHub / generic "sk-" provider keys.
  // 30+ alphanumeric/underscore/dash chars after `sk-` covers OpenAI
  // (sk-proj-, sk-...), Anthropic (sk-ant-...), Stripe (sk_live_, sk_test_),
  // and most "secret key" conventions.
  [/\bsk-(?:proj-|ant-|live_|test_)?[A-Za-z0-9_\-]{24,}\b/g, '<REDACTED:provider-key>'],
  // GitHub PATs (classic ghp_, fine-grained github_pat_, oauth gho_, app gha_, refresh ghs_, server-to-server ghu_)
  [/\bgh[opsuar]_[A-Za-z0-9]{30,}\b/g, '<REDACTED:github-token>'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, '<REDACTED:github-pat>'],
  // AWS access keys (AKIA + SECRETKEY format).
  [/\bAKIA[0-9A-Z]{16}\b/g, '<REDACTED:aws-access-key>'],
  // AWS secret access keys (40 chars base64-ish, anchored to common contexts).
  [/aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}/gi, 'aws_secret_access_key=<REDACTED:aws-secret>'],
  // Slack tokens (xox[abposr]-).
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '<REDACTED:slack-token>'],
  // Google API keys (AIza...).
  [/\bAIza[0-9A-Za-z_\-]{35}\b/g, '<REDACTED:google-key>'],
  // Discord bot tokens (3-segment, base64ish).
  [/\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27,}\b/g, '<REDACTED:discord-token>'],

  // JSON Web Tokens — three-segment base64url separated by dots, header
  // typically begins with eyJ (decoded `{"`).
  [/\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, '<REDACTED:jwt>'],

  // Authorization Bearer headers (HTTP).
  [/\bBearer\s+[A-Za-z0-9._\-+/=]{16,}\b/g, 'Bearer <REDACTED:bearer-token>'],
  // Authorization Basic headers.
  [/\bBasic\s+[A-Za-z0-9+/=]{20,}\b/g, 'Basic <REDACTED:basic-auth>'],

  // PEM private key blocks — replace the whole block (header to footer).
  // RSA / OPENSSH / EC / DSA / generic "PRIVATE KEY".
  [
    /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----/g,
    '<REDACTED:private-key-block>',
  ],

  // Database connection strings with embedded credentials.
  // postgres://user:password@host, mysql://, mongodb(+srv)://, redis://
  [
    /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|rediss):\/\/[^\s:@\/]+:[^\s@\/]+@[^\s\/]+/gi,
    (m) => m.replace(/:\/\/[^@]+@/, '://<REDACTED:db-creds>@'),
  ],
];
// anti-fork-end: secret-sanitizer-patterns

// Substitution markers we ALREADY emit — used to suppress double-redaction
// across proxy restarts where tool_results re-enter the pipeline.
const REDACTED_MARKER_RE = /<REDACTED:[a-z\-]+>/;

function _textOf(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    // Join with '\n' so word boundaries are preserved across blocks. Joining
    // with '' caused regexes anchored on \b to silently miss secrets that
    // happened to be in their own block (verified by tests/specs/
    // secret_sanitizer.test.js — `before` block + key block + `after`
    // block became `beforeKEYafter`, killing the leading `\b`).
    return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('\n');
  }
  return '';
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
    // Apply to ALL tools, not just Bash — Read, Grep, web fetches, etc. can
    // also leak secrets. Cost is one regex sweep per tool_result; the
    // patterns are pre-compiled and short-circuit on no match.
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
