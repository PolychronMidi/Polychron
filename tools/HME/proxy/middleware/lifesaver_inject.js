'use strict';
// lifesaver_inject.js - hook-independent LIFESAVER alert injection.
//
// Replaces the hook-based LIFESAVER scan (userpromptsubmit.sh) which is
// unreliable in VS Code Claude extension mode -- hooks fire intermittently
// for reasons outside our control. The proxy is always running under
// supervisor, so injecting alerts here guarantees delivery on every API
// request instead of depending on the hook dispatcher.
//
// Watermark file is separate from the hook-based tmp/hme-errors.lastread
// so both mechanisms can coexist. If hooks ever fire, both inject -- one
// duplicate banner is cheap; one missed banner is the whole reason this
// exists.
//
// First run seeds the watermark at current line count so proxy boot
// doesn't flood with historical entries. After that, only genuinely new
// hme-errors.log lines trigger injection.

const fs = require('fs');
const path = require('path');

const ERR_LOG = 'log/hme-errors.log';
const WATERMARK = 'tmp/hme-errors.lastread-proxy';

module.exports = {
  name: 'lifesaver_inject',

  onRequest({ payload, ctx }) {
    // Only fire on real Anthropic message requests. Payloads without
    // messages (health probes, etc.) get skipped.
    if (!payload || !Array.isArray(payload.messages)) return;

    const errLogPath = path.join(ctx.PROJECT_ROOT, ERR_LOG);
    const wmPath = path.join(ctx.PROJECT_ROOT, WATERMARK);

    // Read line count
    let content = '';
    try {
      content = fs.readFileSync(errLogPath, 'utf8');
    } catch (_e) {
      return; // no error log yet, nothing to alert
    }
    const lines = content.split('\n').filter(Boolean);
    const totalLines = lines.length;

    // Read watermark (separate from hook-based tmp/hme-errors.lastread)
    let lastSeen = null;
    try {
      const raw = fs.readFileSync(wmPath, 'utf8').trim();
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) lastSeen = n;
    } catch (_e) { /* first run */ }

    // First run: seed watermark at current EOF so we don't dump the entire
    // historical error log into the first request after proxy boot.
    if (lastSeen === null) {
      try { fs.mkdirSync(path.dirname(wmPath), { recursive: true }); } catch (_e) { /* ignore */ }
      try { fs.writeFileSync(wmPath, String(totalLines)); } catch (_e) { /* ignore */ }
      return;
    }

    if (totalLines <= lastSeen) return; // no unread entries

    const unread = lines.slice(lastSeen);
    if (unread.length === 0) return;

    // Build the LIFESAVER banner. Matches the hook-side banner format so
    // downstream expectations (Claude's training + CLAUDE.md conventions)
    // treat it identically.
    const banner =
      'LIFESAVER - ERRORS DETECTED - FIX BEFORE ANYTHING ELSE\n' +
      'Acknowledging an error without fixing it is a CRITICAL VIOLATION.\n' +
      'You MUST: 1) diagnose root cause  2) implement fix  3) verify fix\n\n' +
      unread.join('\n') + '\n\n' +
      'DO NOT proceed with any other task until every error above is FIXED.\n' +
      '(proxy-side injection via lifesaver_inject middleware; the hook-based ' +
      'LIFESAVER path is unreliable in this environment, so this runs on ' +
      'every Anthropic API request instead of per-user-prompt.)';

    // Inject as a system-level block. Anthropic's system field accepts
    // either a string or an array of { type:'text', text, cache_control? }
    // blocks. Normalize to array and append.
    const systemBlock = { type: 'text', text: banner };
    if (typeof payload.system === 'string' && payload.system.length > 0) {
      payload.system = [{ type: 'text', text: payload.system }, systemBlock];
    } else if (Array.isArray(payload.system)) {
      payload.system.push(systemBlock);
    } else {
      payload.system = [systemBlock];
    }
    ctx.markDirty();

    // Advance watermark so we don't re-inject the same lines on every
    // subsequent request. If the model fails to act on the alert, the user
    // can re-append to hme-errors.log to retrigger.
    try { fs.writeFileSync(wmPath, String(totalLines)); } catch (_e) { /* ignore */ }

    console.warn(
      `Acceptable warning: [middleware] lifesaver_inject: injected ${unread.length} unread error(s) into system context`
    );
  },
};
