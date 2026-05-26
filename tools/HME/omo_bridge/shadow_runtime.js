'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { PROJECT_ROOT, RUNTIME_DIR } = require('../proxy/shared');
const { resolveOmo } = require('./dependency');
const { createClientShim } = require('./client_shim');
const { createOpenCodeCompatPlugin } = require('./opencode_compat');
const { createUniversalOpenCodeHost } = require('./opencode_host');
const { emitOmo } = require('./telemetry');
const { UNIVERSAL_HOOK_ABI, validateUniversalEvent } = require('./universal_event');
const { appendJsonl } = require('../proxy/infra/bounded_log');

const EVENT_PHASE = Object.freeze({
  PreToolUse: 'tool.execute.before',
  PostToolUse: 'tool.execute.after',
  PermissionRequest: 'permission.ask',
  SessionStart: 'session.start',
  Stop: 'stop.before',
});

let cachedRuntime = null;

const DEFAULT_LOG = path.join(RUNTIME_DIR, 'omo-shadow-decisions.jsonl');
const DEFAULT_LOG_MAX_BYTES = 1024 * 1024;

function envFlag(name) {
  const value = process.env[name];
  return value === '1' || value === 'true';
}

function timeoutMs(options = {}) {
  const raw = options.timeoutMs ?? process.env.HME_OMO_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 250;
}

function phaseTimeoutEnvName(phase) {
  const suffix = String(phase || '')
    .replace(/\./g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toUpperCase();
  return suffix ? `HME_OMO_TIMEOUT_${suffix}_MS` : '';
}

function timeoutMsForPhase(phase, options = {}) {
  const phaseTimeouts = options.phaseTimeoutMs || {};
  if (Number.isFinite(phaseTimeouts[phase]) && phaseTimeouts[phase] > 0) return phaseTimeouts[phase];
  const envName = phaseTimeoutEnvName(phase);
  const raw = envName ? process.env[envName] : undefined;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return timeoutMs(options);
}

function isShadowEnabled(options = {}) {
  const enabled = options.enabled ?? envFlag('HME_OMO_ENABLED');
  const mode = String(options.mode ?? process.env.HME_OMO_MODE ?? 'shadow');
  return enabled === true && mode === 'shadow';
}

function isLiveEnabled(options = {}) {
  const enabled = options.enabled ?? envFlag('HME_OMO_ENABLED');
  const mode = String(options.mode ?? process.env.HME_OMO_MODE ?? 'shadow');
  return enabled === true && mode === 'live';
}

function isOmoEnabled(options = {}) {
  return isShadowEnabled(options) || isLiveEnabled(options);
}

function isPreloadEnabled(options = {}) {
  const value = options.preload ?? process.env.HME_OMO_PRELOAD;
  return value === undefined ? true : value === true || value === '1' || value === 'true';
}

function isToolBeforeWarmOnly(options = {}) {
  const value = options.toolBeforeWarmOnly ?? process.env.HME_OMO_TOOL_BEFORE_WARM_ONLY;
  return value === true || value === '1' || value === 'true';
}

function allowedPhases(options = {}) {
  const raw = options.phases ?? process.env.HME_OMO_PHASES;
  if (!raw) return null;
  return new Set(String(raw).split(',').map((item) => item.trim()).filter(Boolean));
}

function phaseAllowed(phase, options = {}) {
  const phases = allowedPhases(options);
  return !phases || phases.has(phase);
}

function hashValue(value) {
  if (!value) return '';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function compactPluginResults(results) {
  return Array.isArray(results) ? results.map((item) => item.status).filter(Boolean).join(',') : '';
}

function writeShadowLog(row, options = {}) {
  if (options.log === false) return;
  const logPath = options.logPath || DEFAULT_LOG;
  const maxBytes = Number.isFinite(options.logMaxBytes) && options.logMaxBytes > 0
    ? options.logMaxBytes
    : DEFAULT_LOG_MAX_BYTES;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    appendJsonl(logPath, row, { maxBytes });
  } catch (_err) {
    // Shadow logging must never affect hook decisions.
  }
}

function recordShadowObservation(fields, options = {}) {
  const row = {
    ts: new Date().toISOString(),
    event: fields.event_name || '',
    phase: fields.phase || '',
    status: fields.status || '',
    decision: fields.decision || '',
    plugin_results: fields.plugin_results || '',
    duration_ms: Number.isFinite(fields.duration_ms) ? fields.duration_ms : 0,
    reason_hash: fields.reason_hash || '',
    error_hash: fields.error_hash || '',
  };
  writeShadowLog(row, options);
  emitOmo('omo_shadow_observed', { ...fields, reason_hash: row.reason_hash, error_hash: row.error_hash }, options.telemetry);
  return row;
}

function parsePayload(stdinJson) {
  try { return JSON.parse(stdinJson || '{}'); }
  catch (_err) { return {}; }
}

function buildUniversalEvent(eventName, stdinJson, options = {}) {
  const phase = EVENT_PHASE[eventName];
  if (!phase) return null;
  const payload = parsePayload(stdinJson);
  const toolName = payload.tool_name || payload.tool || '';
  const toolInput = payload.tool_input || payload.input || {};
  const sessionId = payload.session_id || payload.sessionID || payload.thread_id || 'unknown';
  const event = {
    abi: UNIVERSAL_HOOK_ABI,
    id: options.id || `hme-opencode-shadow-${eventName}-${sessionId}`,
    timestamp: new Date().toISOString(),
    source: { host: 'opencode', adapter: 'hme_shadow_runtime', rawEventName: eventName },
    phase,
    session: { id: sessionId, agent: 'opencode', provider: 'opencode' },
    context: { shadow: true, hme_event: eventName },
    payload,
  };
  if (phase.startsWith('tool.execute.') || phase === 'permission.ask') {
    event.tool = {
      id: payload.tool_call_id || payload.callID || payload.call_id || '',
      name: toolName,
      input: toolInput,
    };
  }
  if (phase === 'permission.ask') {
    event.permission = {
      action: payload.action || 'execute',
      target: toolName,
      risk: payload.risk || 'unknown',
      reason: payload.reason || 'HME OpenCode permission shadow observation',
    };
  }
  if (phase === 'chat.params') event.chat = { params: payload.params || {}, messages: payload.messages || [] };
  return event;
}

async function loadConfiguredHooks(options = {}) {
  if (options.hooks) return { status: 'ok', hooks: options.hooks, dependency: { source: 'injected' } };
  const dependency = resolveOmo({
    enabled: true,
    source: options.source ?? process.env.HME_OMO_SOURCE ?? 'path',
    path: options.path ?? process.env.HME_OMO_PATH ?? 'tools/oh-my-openagent',
    packageName: options.packageName ?? process.env.HME_OMO_PACKAGE,
    requiredVersion: options.requiredVersion ?? process.env.HME_OMO_REQUIRED_VERSION ?? '',
    required: false,
    telemetry: options.telemetry,
  });
  if (dependency.status !== 'ok') return { status: 'dependency_error', dependency, error: dependency.error };
  if (!dependency.entrypoint) return { status: 'dependency_error', dependency, error: 'OMO entrypoint not found' };
  const entrypoint = path.join(dependency.root, dependency.entrypoint);
  if (!fs.existsSync(entrypoint)) return { status: 'dependency_error', dependency, error: `OMO entrypoint missing: ${dependency.entrypoint}` };
  try {
    const mod = await import(pathToFileURL(entrypoint).href);
    const pluginModule = mod.default || mod.pluginModule || mod;
    const hooks = pluginModule && typeof pluginModule.server === 'function'
      ? await pluginModule.server({ directory: PROJECT_ROOT, client: createClientShim({ allowMutations: false }) })
      : pluginModule;
    return { status: 'ok', hooks, dependency };
  } catch (err) {
    return { status: 'load_error', dependency, error: err && err.message ? err.message : String(err) };
  }
}

async function createShadowRuntime(options = {}) {
  if (!isOmoEnabled(options)) return { enabled: false, reason: 'disabled' };
  const loaded = await loadConfiguredHooks(options);
  if (loaded.status !== 'ok') return { enabled: false, reason: loaded.status, error: loaded.error, dependency: loaded.dependency };
  const plugin = createOpenCodeCompatPlugin(loaded.hooks, { name: isLiveEnabled(options) ? 'omo-live' : 'omo-shadow', trust: 'external' });
  const host = createUniversalOpenCodeHost({ host: 'opencode', plugins: [plugin], allowExternalLive: true });
  return { enabled: true, host, dependency: loaded.dependency };
}

function withTimeout(work, ms) {
  let timer;
  const task = Promise.resolve().then(work);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('OMO shadow timeout'), { code: 'OMO_SHADOW_TIMEOUT' })), ms);
  });
  return Promise.race([task, timeout]).finally(() => {
    clearTimeout(timer);
    task.catch(() => {});
  });
}

async function observeOmoShadow(eventName, stdinJson, options = {}) {
  if (!isShadowEnabled(options)) return { status: 'disabled' };
  return invokeOmo(eventName, stdinJson, options);
}

async function invokeOmo(eventName, stdinJson, options = {}) {
  if (!isOmoEnabled(options)) return { status: 'disabled' };
  const event = buildUniversalEvent(eventName, stdinJson, options);
  if (!event) return { status: 'unsupported_event' };
  if (eventName === 'SessionStart' && isPreloadEnabled(options) && !cachedRuntime && !options.runtime) {
    cachedRuntime = await createShadowRuntime(options);
    recordShadowObservation({ status: cachedRuntime.enabled ? 'preloaded' : cachedRuntime.reason || 'disabled', event_name: eventName, phase: event.phase, error_hash: hashValue(cachedRuntime.error || '') }, options);
  }
  if (!phaseAllowed(event.phase, options)) {
    recordShadowObservation({ status: 'phase_disabled', event_name: eventName, phase: event.phase }, options);
    return { status: 'phase_disabled' };
  }
  if (
    event.phase === 'tool.execute.before'
    && isToolBeforeWarmOnly(options)
    && !cachedRuntime
    && !options.runtime
  ) {
    recordShadowObservation({ status: 'observe_skipped_cold', event_name: eventName, phase: event.phase }, options);
    return { status: 'observe_skipped_cold' };
  }
  const validation = validateUniversalEvent(event);
  if (!validation.valid) {
    recordShadowObservation({ status: 'invalid_event', event_name: eventName, phase: event.phase, error_hash: hashValue(validation.errors.join(';')) }, options);
    return { status: 'invalid_event', errors: validation.errors };
  }
  try {
    const runtime = options.runtime || cachedRuntime || await createShadowRuntime(options);
    if (!options.runtime) cachedRuntime = runtime;
    if (!runtime.enabled) {
      recordShadowObservation({ status: runtime.reason || 'disabled', event_name: eventName, phase: event.phase, error_hash: hashValue(runtime.error || '') }, options);
      return { status: runtime.reason || 'disabled', error: runtime.error };
    }
    const configuredTimeoutMs = timeoutMsForPhase(event.phase, options);
    const result = await withTimeout(
      () => runtime.host.invokePhase(event, { host: 'opencode', defaultTimeoutMs: configuredTimeoutMs }),
      configuredTimeoutMs
    );
    const decision = result.primaryDecision || { kind: 'allow' };
    recordShadowObservation({
      status: 'ok',
      event_name: eventName,
      phase: event.phase,
      decision: decision.kind || 'allow',
      plugin_results: compactPluginResults(result.results),
      duration_ms: result.durationMs || 0,
      reason_hash: hashValue(decision.reason || decision.machineCode || ''),
    }, options);
    return { status: 'ok', result };
  } catch (err) {
    const status = err && err.code === 'OMO_SHADOW_TIMEOUT' ? 'timeout' : 'error';
    recordShadowObservation({ status, event_name: eventName, phase: event.phase, error_hash: hashValue(err && err.message ? err.message : String(err)) }, options);
    return { status, error: err && err.message ? err.message : String(err) };
  }
}

function denyResult(eventName, reason) {
  const text = String(reason || 'OMO denied request');
  if (eventName === 'Stop') return { stdout: JSON.stringify({ decision: 'block', reason: text }), stderr: ' ', exit_code: 0 };
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName === 'PermissionRequest' ? 'PreToolUse' : eventName,
        permissionDecision: 'deny',
        permissionDecisionReason: text,
      },
    }),
    stderr: ' ',
    exit_code: 0,
  };
}

function modifyToolInput(stdinJson, patch) {
  const payload = parsePayload(stdinJson);
  const updatedInput = patch && typeof patch === 'object' ? patch : {};
  return {
    stdinJson: JSON.stringify({ ...payload, tool_input: updatedInput }),
    result: {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput,
          additionalContext: 'OMO modified tool input; HME validated the modified request.',
        },
      }),
      stderr: ' ',
      exit_code: 0,
    },
  };
}

async function applyOmoLive(eventName, stdinJson, options = {}) {
  if (!isLiveEnabled(options)) return { status: 'disabled', stdinJson };
  const observed = await invokeOmo(eventName, stdinJson, options);
  if (observed.status !== 'ok') return { ...observed, stdinJson };
  const decision = observed.result && observed.result.primaryDecision || { kind: 'allow' };
  if (decision.kind === 'deny') return { ...observed, applied: true, stdinJson, result: denyResult(eventName, decision.reason || decision.machineCode) };
  if (eventName === 'PreToolUse' && decision.kind === 'modify' && decision.target === 'tool.input') {
    return { ...observed, applied: true, ...modifyToolInput(stdinJson, decision.patch) };
  }
  return { ...observed, applied: false, stdinJson };
}

function resetShadowRuntimeForTests() {
  cachedRuntime = null;
}

module.exports = {
  applyOmoLive,
  buildUniversalEvent,
  createShadowRuntime,
  invokeOmo,
  observeOmoShadow,
  phaseTimeoutEnvName,
  recordShadowObservation,
  resetShadowRuntimeForTests,
  timeoutMsForPhase,
};
