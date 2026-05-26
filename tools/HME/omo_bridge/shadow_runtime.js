'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { PROJECT_ROOT } = require('../proxy/shared');
const { resolveOmo } = require('./dependency');
const { createClientShim } = require('./client_shim');
const { createOpenCodeCompatPlugin } = require('./opencode_compat');
const { createUniversalOpenCodeHost } = require('./opencode_host');
const { emitOmo } = require('./telemetry');
const { UNIVERSAL_HOOK_ABI, validateUniversalEvent } = require('./universal_event');

const EVENT_PHASE = Object.freeze({
  PreToolUse: 'tool.execute.before',
  PostToolUse: 'tool.execute.after',
  PermissionRequest: 'permission.ask',
  SessionStart: 'session.start',
  Stop: 'stop.before',
});

let cachedRuntime = null;

function envFlag(name) {
  const value = process.env[name];
  return value === '1' || value === 'true';
}

function timeoutMs(options = {}) {
  const raw = options.timeoutMs ?? process.env.HME_OMO_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 250;
}

function isShadowEnabled(options = {}) {
  const enabled = options.enabled ?? envFlag('HME_OMO_ENABLED');
  const mode = String(options.mode ?? process.env.HME_OMO_MODE ?? 'shadow');
  return enabled === true && mode === 'shadow';
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
  if (!isShadowEnabled(options)) return { enabled: false, reason: 'disabled' };
  const loaded = await loadConfiguredHooks(options);
  if (loaded.status !== 'ok') return { enabled: false, reason: loaded.status, error: loaded.error, dependency: loaded.dependency };
  const plugin = createOpenCodeCompatPlugin(loaded.hooks, { name: 'omo-shadow', trust: 'external' });
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
  const event = buildUniversalEvent(eventName, stdinJson, options);
  if (!event) return { status: 'unsupported_event' };
  const validation = validateUniversalEvent(event);
  if (!validation.valid) {
    emitOmo('omo_shadow_observed', { status: 'invalid_event', event_name: eventName, phase: event.phase, errors: validation.errors.join(';') }, options.telemetry);
    return { status: 'invalid_event', errors: validation.errors };
  }
  try {
    const runtime = options.runtime || cachedRuntime || await createShadowRuntime(options);
    if (!options.runtime) cachedRuntime = runtime;
    if (!runtime.enabled) {
      emitOmo('omo_shadow_observed', { status: runtime.reason || 'disabled', event_name: eventName, phase: event.phase, error: runtime.error || '' }, options.telemetry);
      return { status: runtime.reason || 'disabled', error: runtime.error };
    }
    const configuredTimeoutMs = timeoutMs(options);
    const result = await withTimeout(
      () => runtime.host.invokePhase(event, { host: 'opencode', defaultTimeoutMs: configuredTimeoutMs }),
      configuredTimeoutMs
    );
    emitOmo('omo_shadow_observed', {
      status: 'ok',
      event_name: eventName,
      phase: event.phase,
      decision: result.primaryDecision && result.primaryDecision.kind || 'allow',
      plugin_results: Array.isArray(result.results) ? result.results.map((item) => item.status).join(',') : '',
      duration_ms: result.durationMs || 0,
    }, options.telemetry);
    return { status: 'ok', result };
  } catch (err) {
    const status = err && err.code === 'OMO_SHADOW_TIMEOUT' ? 'timeout' : 'error';
    emitOmo('omo_shadow_observed', { status, event_name: eventName, phase: event.phase, error: err && err.message ? err.message : String(err) }, options.telemetry);
    return { status, error: err && err.message ? err.message : String(err) };
  }
}

function resetShadowRuntimeForTests() {
  cachedRuntime = null;
}

module.exports = {
  buildUniversalEvent,
  createShadowRuntime,
  observeOmoShadow,
  resetShadowRuntimeForTests,
};
