'use strict';
/**
 * Inspect Claude Code's outgoing request payload.
 *
 * When HME_DUMP_SYSTEM_PROMPT=1, writes:
 *   tmp/claude-system-prompt.txt   — formatted view of payload.system
 *   tmp/claude-full-payload.json   — full request body (system + tools +
 *                                    messages + model + all params),
 *                                    pretty-printed JSON. Lets the
 *                                    operator see exactly what Anthropic
 *                                    receives, including tool definitions
 *                                    that live OUTSIDE the system prompt.
 *
 * Position in order.json determines what you see:
 *   - At the TOP of the order array → captures Claude Code's payload
 *     before any HME middleware modifies it (the "raw" view).
 *   - At the BOTTOM → captures the final payload going upstream, including
 *     all HME injections.
 *
 * Off by default: zero cost when HME_DUMP_SYSTEM_PROMPT is unset or 0.
 * Toggle via `.env` then restart the proxy:
 *   HME_DUMP_SYSTEM_PROMPT=1
 *   tools/HME/launcher/polychron-restart.sh
 *
 * Output files are overwritten each request so the latest is always there.
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
    // Full-payload dump — see exactly what Anthropic receives, including
    // tool definitions, message history, sampling params. Skips the
    // `messages` array's content text bodies to keep the file under
    // control on large transcripts (we mostly care about the SHAPE,
    // not the conversation history).
    const fullOut = path.join(ctx.PROJECT_ROOT, 'tmp', 'claude-full-payload.json');
    try {
      const trimmed = { ...payload };
      if (Array.isArray(trimmed.messages)) {
        trimmed._messages_count = trimmed.messages.length;
        trimmed._messages_sample = trimmed.messages.slice(0, 2);
        delete trimmed.messages;
      }
      fs.writeFileSync(fullOut, JSON.stringify(trimmed, null, 2));
    } catch (err) {
      ctx.warn(`dump_system: full-payload write failed: ${err.message}`);
    }
  },
};
