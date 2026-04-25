'use strict';
/**
 * Consolidated HME telemetry surface. Single `record(category, event,
 * fields)` entry that fan-outs to the right files based on category.
 * Existing emission paths (emit.py, statusline, etc.) remain — this
 * module is an additive umbrella that lets new code emit ONCE and have
 * the appropriate channels updated together.
 *
 * Categories:
 *   info     → activity stream JSONL (output/metrics/hme-activity.jsonl)
 *   error    → log/hme-errors.log (LIFESAVER scans this; surface fast)
 *   metric   → log/hme-hook-latency.jsonl (used by universal_pulse for p95)
 *   audit    → log/hme-audit.jsonl (forensic trail; never read by hot path)
 *   debug    → stderr only (silent in production unless TELEMETRY_DEBUG=1)
 *
 * Privacy posture: every category honors HME_TELEMETRY_DISABLE=<comma-list>
 * env var. Disabling 'info' suppresses activity emissions but keeps errors
 * flowing — sensible default for opt-out.
 *
 * Synchronous file appends throughout. emit.py was a detached subprocess
 * for historical reasons (Python required for the JSON formatting it
 * needed); pure JS in-process is simpler and lower-overhead.
 *
 * Failure semantics: every channel write is best-effort. A full disk or
 * permissions error logs to stderr ONCE per process and stops trying.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', '..', '..');

const PATHS = {
  info:    path.join(PROJECT_ROOT, 'output', 'metrics', 'hme-activity.jsonl'),
  error:   path.join(PROJECT_ROOT, 'log', 'hme-errors.log'),
  metric:  path.join(PROJECT_ROOT, 'log', 'hme-hook-latency.jsonl'),
  audit:   path.join(PROJECT_ROOT, 'log', 'hme-audit.jsonl'),
};

const DISABLED = new Set(
  (process.env.HME_TELEMETRY_DISABLE || '').split(',').map((s) => s.trim()).filter(Boolean)
);

const _failed = new Set();

function _ensureDir(file) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (_e) { /* best-effort */ }
}

function _append(channel, line) {
  if (_failed.has(channel)) return;
  const file = PATHS[channel];
  if (!file) return;
  try {
    _ensureDir(file);
    fs.appendFileSync(file, line + '\n');
  } catch (err) {
    process.stderr.write(`[telemetry] ${channel} write failed (suppressing further attempts): ${err.message}\n`);
    _failed.add(channel);
  }
}

/**
 * Single emission entry. category gates the channel; event + fields form
 * the payload. ts auto-stamped if not provided.
 *
 *   record('info',  'edit_tracked',        { file: '/x.js' })
 *   record('error', 'proxy_unreachable',   { url, reason })
 *   record('metric','hook_latency',        { hook: 'stop', duration_ms: 117 })
 *   record('audit', 'nexus_cleared',       { type: 'EDIT', removed: 5, caller })
 */
function record(category, event, fields) {
  if (DISABLED.has(category)) return;
  if (category === 'debug') {
    if (process.env.TELEMETRY_DEBUG === '1') {
      process.stderr.write(`[telemetry/debug] ${event} ${JSON.stringify(fields || {})}\n`);
    }
    return;
  }
  if (category === 'error') {
    // hme-errors.log is line-oriented text (LIFESAVER text-scans it);
    // emit a human-readable line plus a structured tail so downstream
    // tools can parse either shape.
    const ts = (fields && fields.ts) || new Date().toISOString();
    const reason = (fields && (fields.reason || fields.message)) || event;
    const tail = JSON.stringify({ event, ...fields });
    _append('error', `[${ts}] [${event}] ${reason}  ${tail}`);
    return;
  }
  // info / metric / audit are JSONL.
  const payload = { event, ts: Date.now(), ...fields };
  _append(category, JSON.stringify(payload));
}

/**
 * Convenience wrappers — the common cases.
 */
function info(event, fields)   { record('info', event, fields); }
function error(event, fields)  { record('error', event, fields); }
function metric(event, fields) { record('metric', event, fields); }
function audit(event, fields)  { record('audit', event, fields); }
function debug(event, fields)  { record('debug', event, fields); }

module.exports = { record, info, error, metric, audit, debug, PATHS };
