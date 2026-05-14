'use strict';
// Hook-independent LIFESAVER alert injection. Doc: doc/hme_full.md.

const fs = require('fs');
const path = require('path');

const ERR_LOG = 'log/hme-errors.log';
const WATERMARK = 'runtime/hme/errors-lastread.proxy';

// Mirrors lifesaver.sh classification: drop CANARY self-tests,
// observation-severity, and self-origin tags.
const CANARY_RE = /\[CANARY-/;
const OBSERVATION_RE = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;
const SELF_TAG_RE = /^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|worker_client|worker:[^\]]+)\]/;

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

// Once-per-process boot seed: jump watermark to EOF on first request so a
// proxy restart doesn't replay pre-restart errors (already surfaced or
// already filtered the prior turn).
let _startupSeeded = false;

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

    // Boot seed (once per process): jump watermark to EOF so post-restart
    // we don't re-inject pre-restart errors.
    if (!_startupSeeded) {
      _startupSeeded = true;
      try {
        const total = fs.readFileSync(errLogPath, 'utf8').split('\n').filter(Boolean).length;
        try { fs.mkdirSync(path.dirname(wmPath), { recursive: true }); } catch (_e) { /* ignore */ }
        fs.writeFileSync(wmPath, String(total));
      } catch (_e) { /* errLog absent or write fail -- fall through */ }
      return;
    }

    // Read line count
    let content = '';
    try {
      content = fs.readFileSync(errLogPath, 'utf8');
    } catch (_e) {
      return; // no error log yet, nothing to alert
    }
    let lines = content.split('\n').filter(Boolean);
    let totalLines = lines.length;

    // Read watermark (separate from hook-based runtime/hme/errors-lastread)
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
    // Drop canaries / observation-severity / self-origin tags.
    const unread = unreadRaw.filter(_isAgentActionable);
    if (unread.length === 0) {
      // Advance the watermark even on all-skipped so we don't re-scan.
      try { fs.writeFileSync(wmPath, String(totalLines)); } catch (_e) { /* ignore */ }
      return;
    }

    // Advance watermark BEFORE injecting -- a write failure here would
    // otherwise re-inject the same banner forever.
    try {
      fs.writeFileSync(wmPath, String(totalLines));
    } catch (err) {
      console.warn(
        `Acceptable warning: [middleware] lifesaver_inject: watermark write failed (${err.message}); skipping injection to avoid perpetual re-fire`
      );
      return;
    }

    const banner =
      'LIFESAVER -- unresolved errors in hme-errors.log, fix root-cause before proceeding:\n' +
      unread.join('\n');

    // Append to LAST USER MESSAGE (not payload.system) -- mutating
    // system invalidates the prompt-cache prefix every turn.
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
