'use strict';
/**
 * Inspect Claude Code's outgoing system prompt.
 *
 * Writes the FULL system block to tmp/claude-system-prompt.txt on every
 * request when HME_DUMP_SYSTEM_PROMPT=1. Position in order.json determines
 * what you see:
 *   - At the TOP of the order array → captures Claude Code's prompt
 *     before any HME middleware modifies it (the "raw" view).
 *   - At the BOTTOM → captures the final prompt going upstream, including
 *     all HME injections (status, jurisdiction, lifesaver banner).
 *
 * Off by default: zero cost when HME_DUMP_SYSTEM_PROMPT is unset or 0.
 * Toggle via `.env` then restart the proxy:
 *   HME_DUMP_SYSTEM_PROMPT=1
 *   tools/HME/launcher/polychron-restart.sh
 *
 * Output file is overwritten each request so the latest is always there.
 * To capture history, append a session-id suffix in the path below.
 */
const fs = require('fs');
const path = require('path');

const ENABLED = (process.env.HME_DUMP_SYSTEM_PROMPT ?? '0') === '1';

module.exports = {
  name: 'dump_system',
  onRequest({ payload, ctx }) {
    if (!ENABLED) return;
    if (!payload || payload.system == null) return;
    const out = path.join(ctx.PROJECT_ROOT, 'tmp', 'claude-system-prompt.txt');
    let text;
    if (typeof payload.system === 'string') {
      text = payload.system;
    } else if (Array.isArray(payload.system)) {
      text = payload.system
        .map((b, i) => {
          const body = typeof b === 'string' ? b : (b && b.text) || '';
          const cc = b && b.cache_control ? ` cache_control=${JSON.stringify(b.cache_control)}` : '';
          return `--- BLOCK ${i}${cc} ---\n${body}`;
        })
        .join('\n');
    } else {
      text = `(unrecognized payload.system shape: ${typeof payload.system})\n` + JSON.stringify(payload.system, null, 2);
    }
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, text);
    } catch (err) {
      ctx.warn(`dump_system: write failed: ${err.message}`);
    }
  },
};
