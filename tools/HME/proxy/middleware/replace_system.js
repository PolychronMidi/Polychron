'use strict';
/**
 * Wholesale-replace Claude Code's default system prompt with a project-
 * curated one. More robust than surgical pruning: we don't depend on
 * knowing or tracking Claude Code's prompt structure across releases --
 * Anthropic can rephrase, restructure, or rename their sections and our
 * replacement still ships exactly what we wrote.
 *
 * Config file: doc/templates/canonical-system-prompt.md
 *   - Plain text (markdown allowed; Anthropic doesn't parse it).
 *   - Replaces ALL of payload.system with this content as a single
 *     text block. To preserve Claude Code's identity preamble, etc.,
 *     copy the relevant excerpts into your file -- that's the point of
 *     ownership.
 *   - File missing or empty -> middleware no-ops (Claude Code's prompt
 *     ships unmodified).
 *
 * Env gate:
 *   HME_REPLACE_SYSTEM_PROMPT=1   enable replacement
 *   HME_REPLACE_SYSTEM_PROMPT=0   no-op even if the file exists (default)
 *
 * Cache stability: Anthropic's prompt cache hashes the system content.
 * Our replacement is deterministic (same file -> same output), so cache
 * hits work normally. If you edit the canonical file, the next request
 * misses cache once, then re-hits.
 *
 * Position in order.json: AFTER dump_system (so dumps still capture
 * Claude Code's original prompt for inspection) and BEFORE every other
 * middleware (so HME's status/jurisdiction/lifesaver injections append
 * to OUR canonical prompt, not Claude Code's discarded one).
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const ENABLED = (process.env.HME_REPLACE_SYSTEM_PROMPT ?? '0') === '1';
const CANONICAL_PATH = path.join(
  PROJECT_ROOT, 'doc', 'templates', 'canonical-system-prompt.md',
);

// In-memory cache: avoid re-reading the file on every request. Invalidate
// by mtime so edits to the canonical file take effect on the next
// request after save (no proxy restart required).
let _cachedMtime = 0;
let _cachedContent = null;

function _loadCanonical() {
  let stat;
  try {
    stat = fs.statSync(CANONICAL_PATH);
  } catch (_e) {
    _cachedMtime = 0;
    _cachedContent = null;
    return null;
  }
  if (stat.mtimeMs === _cachedMtime && _cachedContent !== null) {
    return _cachedContent;
  }
  try {
    const raw = fs.readFileSync(CANONICAL_PATH, 'utf8');
    if (!raw.trim()) {
      _cachedMtime = stat.mtimeMs;
      _cachedContent = null;
      return null;
    }
    _cachedMtime = stat.mtimeMs;
    _cachedContent = raw;
    return raw;
  } catch (_e) {
    _cachedMtime = 0;
    _cachedContent = null;
    return null;
  }
}

module.exports = {
  name: 'replace_system',
  onRequest({ payload, ctx }) {
    if (process.env.HME_PROXY_LEAN_MODE === '1') return;
    if (!ENABLED) return;
    if (!payload) return;
    const canonical = _loadCanonical();
    if (canonical === null) return; // file missing/empty -> no-op
    // Two-block layout, matching the canonical Claude Code envelope used
    // by horselock/claude-code-proxy and John-Rood/claude-proxy. The
    // OAuth-public endpoint's gateway uses the FIRST system block as a
    // client-fingerprint check: if block[0].text doesn't match the exact
    // canonical identity sentence on its own, the request is routed to a
    // stricter rate-limit bucket (small requests pass, large ones 429
    // with NO anthropic-ratelimit-* headers -- the gateway-rejection
    // signature, distinct from real ITPM exhaustion). Concatenating the
    // identity phrase with our custom content into a single block (the
    // pre-2026-05 layout) failed this check.
    //
    // Block 0: the EXACT identity sentence, alone, no cache_control.
    // Block 1: HME's canonical custom content, with the cache_control
    // breakpoint so the bulk of the system prefix is cached.
    payload.system = [
      {
        type: 'text',
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
      },
      {
        type: 'text',
        text: canonical,
        cache_control: { type: 'ephemeral' },
      },
    ];
    ctx.markDirty();
  },
};
