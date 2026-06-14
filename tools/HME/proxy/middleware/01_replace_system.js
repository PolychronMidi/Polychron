'use strict';
const { requireEnv: _hmeRequireEnv } = require('../shared/load_env.js');
// Replaces Claude Code system prompt with canonical-system-prompt.md when enabled.
// Deterministic cached content keeps prompt-cache behavior stable; disabled is no-op.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const ENABLED = (_hmeRequireEnv('HME_REPLACE_SYSTEM_PROMPT')) === '1';
const CANONICAL_PATH = path.join(
  PROJECT_ROOT, 'doc', 'templates', 'canonical-system-prompt.md',
);

// In-memory cache: avoid re-reading the file on every request. Invalidate
let _cachedMtime = 0;
let _cachedContent = null;

function _loadCanonical() {
  let stat;
  try {
    stat = fs.statSync(CANONICAL_PATH);
    // silent-ok: missing prompt skips replacement; unreadable throws below.
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      _cachedMtime = 0;
      _cachedContent = null;
      return null;
    }
    throw new Error(`canonical system prompt unreadable at ${CANONICAL_PATH}: ${err.message}`);
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
  } catch (err) {
    throw new Error(`canonical system prompt read failed at ${CANONICAL_PATH}: ${err.message}`);
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
    // Two-block layout: block[0] = exact Claude Code identity sentence
    // (OAuth gateway fingerprint check); block[1] = HME custom + cache_control.
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
