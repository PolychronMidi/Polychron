'use strict';
// Hook-independent LIFESAVER alert injection. Doc: doc/LIFESAVER.md.

const fs = require('fs');
const path = require('path');

const ERR_LOG = 'log/hme-errors.log';
const WATERMARK = 'tmp/hme-errors.lastread-proxy';

// Mirrors lifesaver.sh classification: drop CANARY self-tests,
// observation-severity, and self-origin tags.
const CANARY_RE = /\[CANARY-/;
const OBSERVATION_RE = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;
const SELF_TAG_RE = /^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|worker:[^\]]+)\]/;

function _isAgentActionable(line) {
  // Strip the leading "[2026-... ] " timestamp before classifying so the
  // tag-anchored regex matches at line start.
  const body = line.replace(/^\[[0-9TZ:.\-]+\]\s*/, '');
  if (CANARY_RE.test(body)) return false;
  if (SELF_TAG_RE.test(body)) return false;
  if (OBSERVATION_RE.test(body)) return false;
  return true;
}

// Mirrors helpers/safety/latency.sh rotation policy: when the log exceeds
// MAX_LINES, keep the last KEEP_LINES. errors.log had no rotation before;
// it grew unbounded and slowed every tail/scan call.
const MAX_LINES = 10_000;
const KEEP_LINES = 5_000;

function _rotateIfNeeded(errLogPath, wmPath, totalLines, lines) {
  if (totalLines <= MAX_LINES) return { lines, totalLines, lastSeenAdjust: 0 };
  const dropped = totalLines - KEEP_LINES;
  const kept = lines.slice(-KEEP_LINES);
  try {
    fs.writeFileSync(errLogPath, kept.join('\n') + '\n');
    // Bump watermark down by the same delta so we don't re-inject the
    // entire post-rotation file on the next request.
    const wmAdjust = -dropped;
    return { lines: kept, totalLines: KEEP_LINES, lastSeenAdjust: wmAdjust };
  } catch (_e) {
    // Rotation is best-effort; if it fails we leave the file alone and
    // proceed with the unrotated view rather than blocking the inject.
    return { lines, totalLines, lastSeenAdjust: 0 };
  }
}

module.exports = {
  name: 'lifesaver_inject',

  onRequest({ payload, ctx }) {
    // LEAN_MODE: emergency kill-switch when usage budget is being
    // hammered. Set HME_PROXY_LEAN_MODE=1 to skip all heavy middleware
    // injections. Per-turn savings: this skip alone prevents reading
    // the (potentially large) errors.log into the system prompt.
    if (process.env.HME_PROXY_LEAN_MODE === '1') return;
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
    let lines = content.split('\n').filter(Boolean);
    let totalLines = lines.length;

    // Read watermark (separate from hook-based tmp/hme-errors.lastread)
    let lastSeen = null;
    try {
      const raw = fs.readFileSync(wmPath, 'utf8').trim();
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) lastSeen = n;
    } catch (_e) { /* first run */ }

    // Rotation is best done before the watermark math so a freshly-rotated
    // log doesn't make `unread` look like the whole file.
    const rot = _rotateIfNeeded(errLogPath, wmPath, totalLines, lines);
    if (rot.lastSeenAdjust !== 0) {
      lines = rot.lines;
      totalLines = rot.totalLines;
      if (lastSeen !== null) lastSeen = Math.max(0, lastSeen + rot.lastSeenAdjust);
    }

    // First run: seed watermark at current EOF so we don't dump the entire
    // historical error log into the first request after proxy boot.
    if (lastSeen === null) {
      try { fs.mkdirSync(path.dirname(wmPath), { recursive: true }); } catch (_e) { /* ignore */ }
      try { fs.writeFileSync(wmPath, String(totalLines)); } catch (_e) { /* ignore */ }
      return;
    }

    if (totalLines <= lastSeen) return; // no unread entries

    const unreadRaw = lines.slice(lastSeen);
    if (unreadRaw.length === 0) return;
    // Filter to agent-actionable errors only -- canaries, observation-
    // severity entries, and self-origin tags are dropped per the same
    // classification lifesaver.sh applies at the hook layer.
    const unread = unreadRaw.filter(_isAgentActionable);
    if (unread.length === 0) {
      // Still advance the watermark -- the lines exist, they're just
      // non-actionable. Without this, every subsequent request re-reads
      // the same skipped entries hoping to find an actionable one.
      try { fs.writeFileSync(wmPath, String(totalLines)); } catch (_e) { /* ignore */ }
      return;
    }

    // Minimal LIFESAVER banner. Core info is the unread error list and
    // the directive to fix them. Boilerplate ("Acknowledging is a
    // CRITICAL VIOLATION / You MUST 1-2-3 diagnose-fix-verify") is in
    // CLAUDE.md already -- repeating it every turn is context-tax with
    // zero marginal value. Meta-narration about which mechanism fired
    // (was "proxy-side injection via lifesaver_inject middleware...")
    // removed for the same reason -- agent doesn't need delivery-channel
    // trivia.
    // Advance watermark BEFORE injection. Peer-review iter 119: if
    // the watermark write throws (disk full, permission flap, tmpfs
    // evicted), the banner injection at lines below would have
    // completed but the watermark stayed stale -- causing every
    // subsequent request to re-inject the exact same banner forever.
    // Idempotent re-skip is preferable to perpetual re-spam: write
    // first, surface failure loudly so the operator can fix the FS
    // issue rather than silently consuming system-context tokens.
    try {
      fs.writeFileSync(wmPath, String(totalLines));
    } catch (err) {
      console.warn(
        `Acceptable warning: [middleware] lifesaver_inject: watermark write failed (${err.message}); skipping injection to avoid perpetual re-fire -- fix the FS issue and re-append to hme-errors.log to retrigger`
      );
      return;
    }

    const banner =
      'LIFESAVER -- unresolved errors in hme-errors.log, fix root-cause before proceeding:\n' +
      unread.join('\n');

    // CRITICAL cache fix: append the banner to the LAST USER MESSAGE
    // instead of payload.system. Anthropic's prompt cache hashes
    // (system + tools) as the prefix; mutating system invalidates the
    // entire cached prefix on every turn -- which it would, because
    // unread error lines arrive between turns. The previous version
    // pushed a system block here and rebilled the entire system prefix
    // (~tens of thousands of tokens) at full rate every turn, hitting
    // 10%-per-message and rate-limiting the user in ~10 turns.
    //
    // User messages do not break the system+tools cache. Cache savings
    // are 10x or more depending on system size.
    const lastUser = [...payload.messages].reverse().find(
      (m) => m && m.role === 'user'
    );
    if (lastUser) {
      const note = `\n\n[lifesaver inject from proxy]\n${banner}\n`;
      if (typeof lastUser.content === 'string') {
        lastUser.content = lastUser.content + note;
      } else if (Array.isArray(lastUser.content)) {
        lastUser.content.push({ type: 'text', text: note });
      } else {
        lastUser.content = [{ type: 'text', text: note }];
      }
      ctx.markDirty();
    }

    console.warn(
      `Acceptable warning: [middleware] lifesaver_inject: injected ${unread.length} unread error(s) into last-user-message (cache-safe path)`
    );
  },
};
