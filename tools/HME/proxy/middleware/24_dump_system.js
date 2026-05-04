'use strict';
/**
 * Inspect the request payload for debugging cache_control / system shape.
 *
 * When HME_DUMP_SYSTEM_PROMPT=1, writes both:
 *   tmp/claude-system-prompt-pre.txt   -- raw post-Claude-Code, pre-middleware
 *   tmp/claude-system-prompt-post.txt  -- final state going upstream
 *   tmp/claude-full-payload-pre.json
 *   tmp/claude-full-payload-post.json
 *
 * The pre-/post- split lets the operator diff exactly what HME mutated.
 * The pre dump is invoked from hme_proxy.js BEFORE the middleware pipeline
 * runs (and before stripSystemCacheControl); the post dump runs as the
 * `dump_system` middleware near the END of the pipeline, after every
 * mutation including normalizeCacheControlTtls.
 *
 * Off by default: zero cost when HME_DUMP_SYSTEM_PROMPT is unset or 0.
 * Toggle via `.env` then restart the proxy:
 *   HME_DUMP_SYSTEM_PROMPT=1
 *   tools/HME/launcher/polychron-restart.sh
 */
const fs = require('fs');
const path = require('path');

const ENABLED = (process.env.HME_DUMP_SYSTEM_PROMPT ?? '0') === '1';

function _formatSystem(system) {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((b, i) => {
        const body = typeof b === 'string' ? b : (b && b.text) || '';
        const cc = b && b.cache_control ? ` cache_control=${JSON.stringify(b.cache_control)}` : '';
        return `--- BLOCK ${i}${cc} ---\n${body}`;
      })
      .join('\n');
  }
  return `(unrecognized payload.system shape: ${typeof system})\n` + JSON.stringify(system, null, 2);
}

function _trimmedPayload(payload) {
  const trimmed = { ...payload };
  if (Array.isArray(trimmed.messages)) {
    trimmed._messages_count = trimmed.messages.length;
    trimmed._messages_sample = trimmed.messages.slice(0, 2);
    delete trimmed.messages;
  }
  return trimmed;
}

function writeDump(payload, projectRoot, suffix, warn) {
  if (!ENABLED) return;
  if (!payload) return;
  const tag = suffix ? `-${suffix}` : '';
  try { fs.mkdirSync(path.join(projectRoot, 'tmp'), { recursive: true }); } catch (_e) { /* ignore */ }
  if (payload.system != null) {
    const sysOut = path.join(projectRoot, 'tmp', `claude-system-prompt${tag}.txt`);
    try { fs.writeFileSync(sysOut, _formatSystem(payload.system)); }
    catch (err) { warn && warn(`dump_system: system write failed: ${err.message}`); }
  }
  const fullOut = path.join(projectRoot, 'tmp', `claude-full-payload${tag}.json`);
  try { fs.writeFileSync(fullOut, JSON.stringify(_trimmedPayload(payload), null, 2)); }
  catch (err) { warn && warn(`dump_system: full-payload write failed: ${err.message}`); }
}

module.exports = {
  name: 'dump_system',
  writeDump,
  onRequest({ payload, ctx }) {
    if (process.env.HME_PROXY_LEAN_MODE === '1') return;
    writeDump(payload, ctx.PROJECT_ROOT, 'post', (m) => ctx.warn(m));
  },
};
