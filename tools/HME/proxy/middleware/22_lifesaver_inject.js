'use strict';
// Hook-independent LIFESAVER alert injection. Doc: doc/self-coherence-full.md.

const fs = require('fs');
const path = require('path');
const { readAutocommitFailure, touchLifesaverHeartbeat, assertRealLifesaverInjection } = require('../lifesaver_alerts');

const ERR_LOG = 'log/hme-errors.log';
const WATERMARK = 'tools/HME/runtime/errors-lastread.proxy';

// Mirrors lifesaver.sh classification: drop CANARY self-tests,
// observation-severity, and self-origin tags.
const CANARY_RE = /\[CANARY-/;
const OBSERVATION_RE = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;
const SELF_TAG_RE = /^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|worker_client|worker:[^\]]+|hook-failure|hook-stop-block|hook-runtime-error|hook-ui-echo-leak|sessionstart:[^\]]+)\]/;
const HOOK_WATCHDOG_MISSING_RE = /^\[hook-watchdog\]\s+\[ALERT\]\s+UserPromptSubmit fired before successful SessionStart\.\s+\|\s+Session:\s+([0-9a-f]{6,12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i;
const CRITICAL_INFRA_SELF_RE = /^\[(universal_pulse|supervisor)\].*\b(CRITICAL|FAIL|child_restart_limit|restart_limit|giving up|gave up|unhealthy|required)\b/i;

function _isAgentActionable(line) {
  // tag-anchored regex matches at line start.
  const body = line.replace(/^\[[0-9TZ:.\-]+\]\s*/, '');
  const criticalInfra = CRITICAL_INFRA_SELF_RE.test(body);
  if (CANARY_RE.test(body)) return false;
  if (SELF_TAG_RE.test(body) && !criticalInfra) return false;
  if (HOOK_WATCHDOG_MISSING_RE.test(body)) return false;
  if (OBSERVATION_RE.test(body) && !criticalInfra) return false;
  return true;
}

// Mirrors helpers/safety/latency.sh rotation policy: when the log exceeds
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
    // silent-ok: optional fallback path.
    // Rotation is best-effort; if it fails we leave the file alone and
    // proceed with the unrotated view rather than blocking the inject.
    return { lines, totalLines, lastSeenAdjust: 0 };
  }
}

// Once-per-process boot seed for historical error-log entries.
let _startupSeeded = false;

function _appendToLastUser(payload, note) {
  const lastUser = [...payload.messages].reverse().find(
    (m) => m && m.role === 'user'
  );
  if (!lastUser) return false;
  if (typeof lastUser.content === 'string') {
    lastUser.content = lastUser.content + note;
  } else if (Array.isArray(lastUser.content)) {
    lastUser.content.push({ type: 'text', text: note });
  } else {
    lastUser.content = [{ type: 'text', text: note }];
  }
  return true;
}


module.exports = {
  name: 'lifesaver_inject',

  onRequest({ payload, ctx }) {
    // LEAN_MODE: emergency kill-switch when usage budget is constrained.
    if (process.env.HME_PROXY_LEAN_MODE === '1') return;
    // Only fire on real Anthropic message requests. Payloads without
    // messages (health probes, etc.) get skipped.
    if (!payload || !Array.isArray(payload.messages)) return;
    touchLifesaverHeartbeat(ctx.PROJECT_ROOT);

    const acFailure = readAutocommitFailure(ctx.PROJECT_ROOT);
    if (acFailure && _appendToLastUser(
      payload,
      `\n\n[lifesaver inject from proxy]\n${acFailure.banner}\n`,
    )) {
      assertRealLifesaverInjection(ctx.PROJECT_ROOT, 'autocommit', acFailure.banner, { flag: acFailure.flagPath });
      ctx.markDirty();
      ctx.emit({ event: 'lifesaver_injected', source: 'autocommit', flag: acFailure.flagPath });
    }

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
      // silent-ok: optional fallback path.
      return; // no error log yet, nothing to alert
    }
    let lines = content.split('\n').filter(Boolean);
    let totalLines = lines.length;

    // Read watermark (separate from hook-based tools/HME/runtime/errors-lastread)
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
      ctx.emit({ event: 'lifesaver_watermark_failed', message: err.message });
      return;
    }

    const banner =
      'LIFESAVER -- unresolved errors in hme-errors.log, fix root-cause before proceeding:\n' +
      unread.join('\n');

    // Append to LAST USER MESSAGE (not payload.system) -- mutating
    // system invalidates the prompt-cache prefix every turn.
    if (_appendToLastUser(payload, `\n\n[lifesaver inject from proxy]\n${banner}\n`)) {
      assertRealLifesaverInjection(ctx.PROJECT_ROOT, 'error_log', banner, { count: unread.length });
      ctx.markDirty();
    }

    ctx.emit({ event: 'lifesaver_injected', source: 'error_log', count: unread.length });
  },
};
