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

function _outboundPreflightOverWindow(line, root) {
  if (!/UPSTREAM_PREFLIGHT_OVER_WINDOW/i.test(line)) return null;
  const budget = Number((/route budget\s+(\d+)/i.exec(line) || [])[1] || 0);
  const model = String((/\bfor\s+([^;\s]+)/i.exec(line) || [])[1] || '');
  let statusline = { used: 0, size: 0, modelId: '' };
  try { statusline = require('./context_pressure').statuslineUsage(process.env, root); } catch (_e) { /* resolver proof falls through below */ }
  const used = Number(statusline && statusline.used || 0);
  const resolved = Boolean(budget > 0 && used > 0 && used <= budget);
  return {
    resolved,
    kind: 'outbound_preflight_over_window',
    resolver: 'current Claude statusline usage <= refused route budget',
    proof: { model, budget, statuslineUsed: used, statuslineModel: statusline.modelId || '', statuslineSize: statusline.size || 0 },
    reason: resolved
      ? 'the live session is now under the route budget that was previously refused'
      : 'live statusline does not prove the session is back under the refused route budget',
    invariant: 'outbound payload stays within the target route context budget before shipping',
    runtimeState: `model=${model || '?'} refusedBudget=${budget || '?'} currentStatuslineUsed=${used || '?'}`,
    recurrenceTest: 'tools/HME/tests/specs/outbound_context_gate.test.js; tools/HME/tests/specs/incident_registry.test.js',
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

function _providersToSkip(root) {
  const cfg = _readJson(path.join(root, 'config', 'models.json')) || {};
  const raw = cfg.providers_to_skip && Array.isArray(cfg.providers_to_skip.providers)
    ? cfg.providers_to_skip.providers : [];
  const out = new Set();
  for (const entry of raw.flatMap((v) => String(v).split(','))) {
    const p = entry.trim().toLowerCase().replace(/_/g, '-');
    if (!p) continue;
    out.add(p);
    if (p === 'anthropic') out.add('claude');
    if (p === 'claude') out.add('anthropic');
  }
  return out;
}

function _upstreamNoCredentialsForSkippedProvider(line, root) {
  if (!/UPSTREAM_400_INTERACTIVE:\s*omniroute 400 invalid_request_error \[interactive\]:\s*No credentials for provider:/i.test(line)) return null;
  const provider = String((/No credentials for provider:\s*([^\s)]+)/i.exec(line) || [])[1] || '').toLowerCase().replace(/_/g, '-');
  const skipped = _providersToSkip(root).has(provider);
  return {
    resolved: skipped,
    kind: 'upstream_no_credentials_for_skipped_provider',
    resolver: 'providers_to_skip + overdrive no-route local refusal',
    proof: { provider, skipped },
    reason: skipped
      ? 'the uncredentialed provider is currently paused/skipped and routing now refuses empty chains locally instead of falling back to it'
      : 'the uncredentialed provider is not in providers_to_skip, so credentials or routing still need repair',
    invariant: 'a skipped/uncredentialed provider must never be selected as the fallback route',
    runtimeState: `provider=${provider || '?'} skipped=${skipped}`,
    recurrenceTest: 'tools/HME/tests/specs/incident_registry.test.js; tools/HME/tests/specs/overdrive_size_gate.test.js',
  };
}

function _upstreamInvalidBearerPreflightSmoke(line, root) {
  if (!/UPSTREAM_401_INTERACTIVE:\s*anthropic 401 authentication_error \[interactive\]:\s*Invalid bearer token/i.test(line)
      && !/PROXY_EMERGENCY:.*anthropic 401 authentication_error \[interactive\]: Invalid bearer token/i.test(line)) return null;
  const m = /snapshot=([^\s)]+)/.exec(line);
  const snapshotRel = m && m[1] ? m[1] : '';
  const headerFile = snapshotRel ? path.join(root, snapshotRel).replace(/\.json$/, '.request-headers.json') : '';
  const headers = headerFile ? (_readJson(headerFile) || {}) : {};
  const incoming = headers.incoming_headers || {};
  const outgoing = headers.outgoing_headers || {};
  const preflight = incoming['x-hme-preflight-smoke'] === '1' || outgoing['x-hme-preflight-smoke'] === '1'
    || /Bearer\s+hme-preflight/i.test(String(incoming.authorization || outgoing.authorization || ''));
  const liveSource = (() => {
    try { return fs.readFileSync(path.join(root, 'tools/HME/proxy/outbound_context_gate.js'), 'utf8'); } catch (_e) { return ''; }
  })();
  const localTerminationPresent = liveSource.includes("X-HME-Preflight-Smoke')") || liveSource.includes('X-HME-Preflight-Smoke');
  const headerGuardPresent = (() => {
    try { return fs.readFileSync(path.join(root, 'tools/HME/proxy/hme_proxy_headers.js'), 'utf8').includes('isPreflightSmoke'); } catch (_e) { return false; }
  })();
  const resolved = Boolean(preflight && localTerminationPresent && headerGuardPresent);
  return {
    resolved,
    kind: 'upstream_invalid_bearer_preflight_smoke',
    resolver: 'preflight smoke is now terminated locally before upstream auth',
    snapshot: snapshotRel,
    proof: { preflight, localTerminationPresent, headerGuardPresent },
    reason: resolved
      ? 'historical invalid bearer came from the slot preflight smoke token; current code returns local smoke responses instead of forwarding that fake credential'
      : 'not proven to be a preflight-smoke invalid bearer or current local smoke termination is absent',
    invariant: 'slot preflight smoke must never hit real Anthropic authentication',
    runtimeState: `snapshot=${snapshotRel || '(none)'} preflight=${preflight}`,
    recurrenceTest: 'tools/HME/tests/specs/outbound_context_gate.test.js; tools/HME/tests/specs/polychron_restart_contract.test.js',
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

function _shufflerAutoHeal(line, root) {
  if (!/\[shuffler\]\s+LIFESAVER\s+(?:shuffler|file_watcher|slot_watchdog) was dead; respawned by proxy-supervisor \(auto-heal had stopped\)/i.test(line)) return null;
  const procMap = { shuffler: 'shuffler.js', file_watcher: 'file_watcher.js', slot_watchdog: 'slot_watchdog.js' };
  const m = /LIFESAVER\s+(shuffler|file_watcher|slot_watchdog) was dead/i.exec(line);
  const name = m && m[1] ? m[1] : '';
  const script = procMap[name] || '';
  const alive = script ? (() => { try { require('child_process').execFileSync('pgrep', ['-f', `shuffler/${script}`], { timeout: 1000, stdio: ['ignore', 'ignore', 'ignore'] }); return true; } catch (_e) { return false; } })() : false;
  return {
    resolved: alive,
    kind: 'shuffler_auto_heal',
    resolver: 'proxy-supervisor verified replacement process alive',
    proof: { name, script, alive },
    reason: alive ? 'helper process was auto-healed and is currently alive' : 'helper process is not alive after attempted auto-heal',
    invariant: 'shuffler helper procs remain supervised and alive',
    runtimeState: `${name || 'unknown'} alive=${alive}`,
    recurrenceTest: 'tools/HME/tests/specs/policy_universalization.test.js; tools/HME/tests/specs/incident_registry.test.js',
  };
}

function _currentRuntimeFingerprint(root) {
  try { return require('./proxy_runtime_fingerprint').currentRuntimeFingerprint(root); }
  catch (_e) { return ''; }
}

function _staleRuntime(line, root) {
  if (!/\[stale_runtime\]|slot [ab] stranded on stale code|proxy is NOT serving current code/i.test(line)) return null;
  const head = _shortSha(root);
  const wantedFingerprint = _currentRuntimeFingerprint(root);
  const runtime = _readJson(path.join(root, 'tools/HME/runtime/proxy-runtime.json'));
  const live = runtime && String(runtime.git_sha || '');
  const liveFingerprint = runtime && String(runtime.runtime_fingerprint || '');
  const liveShort = live ? live.slice(0, head.length || 12) : '';
  const slots = _slotHealthSummary(root);
  const slotHealthy = Object.values(slots).some((h) => h && h.alive && h.ready && !h.draining && Number(h.age_ms) <= 120000
    && (!wantedFingerprint || String(h.runtime_fingerprint || '') === wantedFingerprint));
  const runtimeHealthy = Boolean(wantedFingerprint && liveFingerprint === wantedFingerprint);
  const gitHealthy = Boolean(head && live && (live === head || live.startsWith(head) || head.startsWith(liveShort)));
  const resolved = Boolean(runtimeHealthy || slotHealthy || gitHealthy);
  return {
    resolved,
    kind: 'runtime_convergence',
    resolver: 'proxy runtime fingerprint/slot health matches current code',
    proof: { head, live, wantedFingerprint, liveFingerprint, slots },
    reason: resolved ? 'live proxy slot/runtime now serves current runtime fingerprint' : 'runtime fingerprint not proven current',
    invariant: 'proxy runtime serves current code',
    runtimeState: `head=${head || '?'} live=${live || '?'} wantedFingerprint=${wantedFingerprint || '?'} liveFingerprint=${liveFingerprint || '?'} slots=${JSON.stringify(slots).slice(0, 500)}`,
    recurrenceTest: 'tools/HME/tests/specs/polychron_restart_contract.test.js; tools/HME/tests/specs/incident_registry.test.js',
  };
}

const RESOLVERS = [_observationOrSelf, _autocommitResolved, _upstreamContextWindow, _outboundPreflightOverWindow, _upstreamTransient200ApiError, _upstreamNoCredentialsForSkippedProvider, _shufflerAutoHeal, _staleRuntime];

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
