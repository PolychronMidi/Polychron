'use strict';

const fs = require('fs');
const path = require('path');

function _readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return null; }
}
function _readBuf(file) {
  try { return fs.readFileSync(file); } catch (_e) { return null; }
}

function _shortSha(root) {
  try { return require('child_process').execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_e) { return ''; }
}

function _observationOrSelf(line, _root) {
  const selfOrigin = require('./self_origin');
  const body = selfOrigin.stripTs(line);
  if (selfOrigin.isObservation(body)) return { resolved: true, kind: 'observation', resolver: 'self_origin.isObservation', proof: { line: body.slice(0, 160) }, reason: 'observation severity is not agent debt' };
  if (selfOrigin.isSelfOrigin(body)) return { resolved: true, kind: 'self_origin', resolver: 'self_origin.isSelfOrigin', proof: { line: body.slice(0, 160) }, reason: 'self-origin historical line is not open agent debt' };
  return null;
}

function _autocommitResolved(line, root) {
  if (!/\[autocommit\].*pre-commit validation blocked/i.test(line)) return null;
  const out = (() => { try { return require('child_process').execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_e) { return '__git_status_failed__'; } })();
  return {
    resolved: out === '', kind: 'autocommit', resolver: 'git status --short empty', proof: { status: out },
    reason: out === '' ? 'working tree is clean' : 'working tree still dirty or unproven',
    invariant: 'working tree is committed (no uncommitted edits)',
    runtimeState: `git status --short: ${out === '' ? '(clean)' : out.slice(0, 200)}`,
    recurrenceTest: 'tools/HME/tests/specs/autocommit_health.test.py',
  };
}

function _upstreamContextWindow(line, root) {
  if (!/UPSTREAM_200_INTERACTIVE:.*context window/i.test(line)) return null;
  const m = /snapshot=([^\s)]+)/.exec(line);
  if (!m) return { resolved: false, kind: 'upstream_context_window', reason: 'missing snapshot pointer' };
  const snapshotRel = m[1];
  const snapshot = path.join(root, snapshotRel);
  const payload = _readJson(snapshot);
  if (!payload) return { resolved: false, kind: 'upstream_context_window', reason: 'snapshot not readable', snapshot: snapshotRel };
  const { evaluateOutbound } = require('./outbound_context_gate');
  const model = String(payload.model || '').includes('/') ? String(payload.model).split('/').slice(1).join('/') : String(payload.model || '');
  const verdict = evaluateOutbound({ payload: JSON.parse(JSON.stringify(payload)), modelId: model, swapChain: [] });
  return {
    resolved: verdict && verdict.ok === false && verdict.action === 'over_window',
    kind: 'upstream_context_window',
    resolver: 'outbound_context_gate.evaluateOutbound',
    snapshot: snapshotRel,
    proof: verdict,
    reason: verdict && verdict.ok === false ? 'captured payload is now refused locally' : 'captured payload still not refused locally',
    invariant: 'outbound payload stays within the model context window',
    runtimeState: `snapshot=${snapshotRel}`,
    recurrenceTest: 'tools/HME/tests/specs/coherence_substrate.test.js (upstream context-window resolver)',
  };
}

function _upstreamTransient200ApiError(line, root) {
  if (!/UPSTREAM_200_INTERACTIVE:\s*omniroute 200 api_error \[interactive\]/i.test(line)) return null;
  if (/context window/i.test(line)) return null;
  const m = /snapshot=([^\s)]+)/.exec(line);
  const snapshotRel = m && m[1] ? m[1] : '';
  const snapshot = snapshotRel ? path.join(root, snapshotRel) : '';
  const response = snapshot ? _readBuf(snapshot.replace(/\.json$/, '.response')) : null;
  const headers = snapshot ? (_readJson(snapshot.replace(/\.json$/, '.headers.json')) || {}) : {};
  let errInfo = null;
  try {
    if (response) {
      const { detectUpstreamFailure } = require('./contexts/failure_policy/failure_classification');
      errInfo = detectUpstreamFailure(200, headers, response);
    }
  } catch (_e) { /* resolver proof falls back to the line text below */ }
  if (!errInfo) {
    const msg = (/api_error \[interactive\]:\s*(.*?)\s*\(request_id=/.exec(line) || [])[1] || '';
    errInfo = { type: 'api_error', message: msg };
  }
  const { classifyFailure } = require('./contexts/failure_policy/omni_failure_policy');
  const failureKind = classifyFailure(200, errInfo);
  const resolved = failureKind === 'stream_timeout';
  return {
    resolved,
    kind: 'upstream_transient_200_api_error',
    resolver: 'omni_failure_policy.classifyFailure + retryStreamTimeout',
    snapshot: snapshotRel,
    proof: { failureKind, type: errInfo.type || '', message: String(errInfo.message || '').slice(0, 220) },
    reason: resolved
      ? 'generic status-200 OmniRoute api_error is now treated as a retryable stream interruption/external upstream observation, not open agent repair debt'
      : 'status-200 OmniRoute api_error is not covered by the retryable-transient policy',
    invariant: 'status-200 SSE api_error must retry same target before surfacing as unresolved agent debt',
    runtimeState: `snapshot=${snapshotRel || '(none)'}`,
    recurrenceTest: 'tools/HME/tests/specs/omni_failure_policy.test.js; tools/HME/tests/specs/omniroute_stream_timeout_retry.test.js; tools/HME/tests/specs/incident_registry.test.js',
  };
}

function _slotHealthSummary(root) {
  const out = {};
  for (const slot of ['a', 'b']) {
    const h = _readJson(path.join(root, 'tools/HME/runtime', `proxy-${slot}.health`));
    const alive = h && Number.isInteger(Number(h.pid)) ? (() => { try { process.kill(Number(h.pid), 0); return true; } catch (_e) { return false; } })() : false;
    out[slot] = h ? {
      pid: h.pid,
      alive,
      ready: Boolean(h.ready),
      draining: Boolean(h.draining),
      age_ms: Date.now() - Number(h.ts || 0),
      runtime_fingerprint: String(h.runtime_fingerprint || ''),
      git_sha: String(h.git_sha || ''),
    } : { missing: true };
  }
  return out;
}

function _staleRuntime(line, root) {
  if (!/\[stale_runtime\]|slot [ab] stranded on stale code|proxy is NOT serving current code/i.test(line)) return null;
  const head = _shortSha(root);
  const runtime = _readJson(path.join(root, 'tools/HME/runtime/proxy-runtime.json'));
  const live = runtime && String(runtime.git_sha || '');
  const liveShort = live ? live.slice(0, head.length || 12) : '';
  const slots = _slotHealthSummary(root);
  const slotHealthy = Object.values(slots).some((h) => h && h.alive && h.ready && !h.draining && Number(h.age_ms) <= 120000 && (!head || String(h.git_sha || '').startsWith(head)));
  const resolved = Boolean(head && ((live && (live === head || live.startsWith(head) || head.startsWith(liveShort))) || slotHealthy));
  return {
    resolved,
    kind: 'runtime_convergence',
    resolver: 'proxy-runtime.git_sha/slot health == HEAD',
    proof: { head, live, slots },
    reason: resolved ? 'live proxy slot/runtime now serves current HEAD' : 'runtime fingerprint not proven current',
    invariant: 'proxy runtime serves current HEAD code',
    runtimeState: `head=${head || '?'} live=${live || '?'} slots=${JSON.stringify(slots).slice(0, 500)}`,
    recurrenceTest: 'tools/HME/tests/specs/polychron_restart_contract.test.js; tools/HME/tests/specs/incident_registry.test.js',
  };
}

const RESOLVERS = [_observationOrSelf, _autocommitResolved, _upstreamContextWindow, _upstreamTransient200ApiError, _staleRuntime];

function resolveLine(root, line) {
  for (const r of RESOLVERS) {
    const out = r(String(line || ''), root);
    if (out) return out;
  }
  return { resolved: false, kind: 'unclassified', resolver: '', proof: {}, reason: 'no resolver registered' };
}

function unresolvedLines(root, lines) {
  return (lines || []).filter((line) => !resolveLine(root, line).resolved);
}

module.exports = { RESOLVERS, resolveLine, unresolvedLines };
