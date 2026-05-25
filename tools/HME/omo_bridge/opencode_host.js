const { createClientShim } = require('./client_shim');
const { toOpenCodePluginInput, HOOK_MAP } = require('./lifecycle_map');
const { invokeOmoHook } = require('./hook_adapter');
const { supportsDecision } = require('./host_capabilities');
const { createOpenCodeCompatPlugin } = require('./opencode_compat');
const { sandboxViolation } = require('./plugin_sandbox');
const { assertUniversalEvent, SUPPORTED_PHASES } = require('./universal_event');
const { DECISION_TARGETS, validateUniversalDecision } = require('./universal_decision');
const { resolveUniversalDecisions } = require('./decision_resolver');

const TRUST_ORDER = Object.freeze({ kernel: 0, project: 1, external: 2, optional: 3 });
const OBSERVE_DECISIONS = Object.freeze(['allow', 'defer']);
const APPROVED_EFFECT_KINDS = Object.freeze(['telemetry', 'log', 'counter', 'state.write', 'state.delete']);
const DEFAULT_PHASE_TIMEOUT_MS = Object.freeze({
  'chat.params': 500,
  'permission.ask': 250,
  'tool.execute.before': 250,
  'tool.execute.after': 250,
  'stop.before': 250,
  'stream.text_block': 50,
  'session.start': 100,
  'session.end': 100,
  'message.input': 100,
  'message.output': 100,
  'stream.delta': 25,
  'policy.evaluate': 250,
  'telemetry.event': 100,
});
const SAFETY_TIMEOUT_PHASES = Object.freeze(['permission.ask', 'tool.execute.before', 'stop.before']);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function pluginTrust(plugin = {}) {
  return TRUST_ORDER[plugin.trust] === undefined ? 'optional' : plugin.trust;
}

function pluginName(plugin = {}, index = 0) {
  return plugin.name || `plugin_${index}`;
}

function phaseList(plugin = {}) {
  const phases = new Set(asArray(plugin.phase).concat(asArray(plugin.phases)));
  for (const phase of Object.keys(plugin.hooks || {})) phases.add(phase);
  for (const phase of SUPPORTED_PHASES) {
    if (typeof plugin[phase] === 'function') phases.add(phase);
  }
  return [...phases].filter((phase) => SUPPORTED_PHASES.includes(phase));
}

function hookForPhase(plugin = {}, phase) {
  if (plugin.hooks && typeof plugin.hooks[phase] === 'function') return plugin.hooks[phase];
  if (plugin.phase === phase && typeof plugin.handler === 'function') return plugin.handler;
  if (Array.isArray(plugin.phases) && plugin.phases.includes(phase) && typeof plugin.handler === 'function') return plugin.handler;
  if (typeof plugin[phase] === 'function') return plugin[phase];
  return null;
}

function normalizePlugin(plugin, index) {
  const normalized = {
    ...plugin,
    name: pluginName(plugin, index),
    trust: pluginTrust(plugin),
    order: Number.isFinite(plugin.order) ? plugin.order : index,
    phases: phaseList(plugin),
  };
  return Object.freeze(normalized);
}

function sortPlugins(left, right) {
  return TRUST_ORDER[left.trust] - TRUST_ORDER[right.trust]
    || left.order - right.order
    || left.name.localeCompare(right.name);
}

function normalizeOutput(output) {
  if (output === undefined || output === null) return { kind: 'allow' };
  if (output.decision && typeof output.decision === 'object') return output.decision;
  return output;
}

function allowedDecisionKinds(plugin = {}) {
  const capabilities = plugin.capabilities || {};
  return asArray(capabilities.decisions || capabilities.decisionKinds);
}

function canEmitDecision(plugin, decision = {}) {
  const kind = decision.kind;
  if (OBSERVE_DECISIONS.includes(kind)) return true;
  const allowedKinds = allowedDecisionKinds(plugin);
  if (!allowedKinds.includes(kind) && !allowedKinds.includes('*')) return false;
  const targetKinds = Object.keys(DECISION_TARGETS);
  if (!targetKinds.includes(kind)) return true;
  const targets = (((plugin.capabilities || {}).targets || {})[kind]) || [];
  return targets.includes('*') || targets.includes(decision.target);
}

function canEmitEffects(plugin, decision = {}) {
  const effects = decision.effects || [];
  const allowed = new Set(asArray(((plugin.capabilities || {}).effects) || ['telemetry', 'log', 'counter']));
  return effects.every((effect) => APPROVED_EFFECT_KINDS.includes(effect.kind) && allowed.has(effect.kind));
}

function phaseTimeout(phase, options = {}) {
  const timeoutMs = options.timeoutMs || {};
  if (Number.isFinite(timeoutMs[phase])) return timeoutMs[phase];
  if (Number.isFinite(options.defaultTimeoutMs)) return options.defaultTimeoutMs;
  return DEFAULT_PHASE_TIMEOUT_MS[phase] || 100;
}

function timeoutDecision(phase, plugin) {
  if (plugin.mandatory === true || SAFETY_TIMEOUT_PHASES.includes(phase)) {
    return { kind: 'deny', reason: `Plugin ${plugin.name} timed out`, machineCode: 'opencode_plugin_timeout' };
  }
  return { kind: 'defer', reason: `Plugin ${plugin.name} timed out`, machineCode: 'opencode_plugin_timeout' };
}

function withTimeout(work, ms) {
  let timer;
  const task = Promise.resolve().then(work);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('plugin timeout'), { code: 'PLUGIN_TIMEOUT' })), ms);
  });
  return Promise.race([task, timeout]).finally(() => {
    clearTimeout(timer);
    task.catch(() => {});
  });
}

function result(status, plugin, phase, fields = {}) {
  return { status, plugin: plugin.name, trust: plugin.trust, phase, ...fields };
}

function withDuration(started, item) {
  return { ...item, durationMs: Date.now() - started };
}

function validatePluginDecision({ decision, plugin, phase, host, sandbox }) {
  const validation = validateUniversalDecision(decision);
  if (!validation.valid) return { status: 'invalid_decision', errors: validation.errors };
  if (!canEmitDecision(plugin, decision)) return { status: 'capability_violation', errors: [`${plugin.name} cannot emit ${decision.kind}`] };
  if (!canEmitEffects(plugin, decision)) return { status: 'capability_violation', errors: [`${plugin.name} used an unapproved effect`] };
  const sandboxError = sandboxViolation(plugin, decision, sandbox);
  if (sandboxError) return { status: 'sandbox_violation', errors: [sandboxError] };
  if (!supportsDecision(host, phase, decision)) return { status: 'unsupported_decision', errors: [`${host} does not support ${decision.kind} for ${phase}`] };
  return { status: 'applied', errors: [] };
}

async function invokePlugin({ plugin, phase, host, event, timeoutMs, sandbox }) {
  const started = Date.now();
  const hook = hookForPhase(plugin, phase);
  if (!hook) return withDuration(started, result('skipped', plugin, phase));
  try {
    const output = await withTimeout(() => hook(cloneJson(event), { phase, host, plugin: plugin.name, trust: plugin.trust }), timeoutMs);
    const decision = normalizeOutput(output);
    const verdict = validatePluginDecision({ decision, plugin, phase, host, sandbox });
    if (verdict.status !== 'applied') return withDuration(started, result(verdict.status, plugin, phase, { decision, errors: verdict.errors, applied: false }));
    return withDuration(started, result('applied', plugin, phase, { decision, effects: decision.effects || [], applied: true }));
  } catch (error) {
    if (error && error.code === 'PLUGIN_TIMEOUT') {
      const decision = timeoutDecision(phase, plugin);
      return withDuration(started, result('timeout', plugin, phase, { decision, applied: decision.kind === 'deny', error: error.message }));
    }
    return withDuration(started, result('error', plugin, phase, { applied: false, error: error && error.message ? error.message : String(error) }));
  }
}

function selectPrimaryDecision(results) {
  return resolveUniversalDecisions(results.filter((item) => item.applied && item.decision)).decision;
}

function collectEffects(results) {
  return results
    .filter((item) => item.applied && Array.isArray(item.effects))
    .flatMap((item) => item.effects.map((effect) => ({ ...effect, plugin: item.plugin, trust: item.trust })));
}

function createUniversalOpenCodeHost(options = {}) {
  const state = {
    defaultHost: options.host || 'opencode',
    enabled: options.enabled !== false,
    timeoutMs: options.timeoutMs || {},
    sandbox: options.sandbox || { allowExternalLive: options.allowExternalLive === true },
    plugins: [],
  };

  function registerPlugin(plugin) {
    const normalized = normalizePlugin(plugin || {}, state.plugins.length);
    state.plugins = [...state.plugins, normalized].sort(sortPlugins);
    return normalized;
  }

  asArray(options.plugins).forEach(registerPlugin);

  function pluginsForPhase(phase) {
    return state.plugins.filter((plugin) => plugin.phases.includes(phase));
  }

  async function invokePhase(universalEvent, invokeOptions = {}) {
    if (!state.enabled || invokeOptions.enabled === false) return { skipped: true, reason: 'disabled', primaryDecision: { kind: 'allow' }, results: [] };
    const event = assertUniversalEvent(universalEvent);
    const phase = event.phase;
    const host = invokeOptions.host || (event.source && event.source.host) || state.defaultHost;
    const timeoutMs = { ...state.timeoutMs, ...(invokeOptions.timeoutMs || {}) };
    const started = Date.now();
    const results = [];
    for (const plugin of pluginsForPhase(phase)) {
      results.push(await invokePlugin({ plugin, phase, host, event, timeoutMs: phaseTimeout(phase, { ...invokeOptions, timeoutMs }), sandbox: state.sandbox }));
    }
    const resolution = resolveUniversalDecisions(results.filter((item) => item.applied && item.decision));
    return {
      phase,
      host,
      results,
      decisions: results.filter((item) => item.applied && item.decision).map((item) => item.decision),
      effects: collectEffects(results),
      resolution,
      primaryDecision: resolution.decision,
      durationMs: Date.now() - started,
    };
  }

  return { registerPlugin, pluginsForPhase, invokePhase, plugins: () => [...state.plugins] };
}

async function createOpenCodeHost(pluginFactory, options = {}) {
  const client = options.client || createClientShim(options);
  const plugin = typeof pluginFactory === 'function'
    ? await pluginFactory({ directory: options.directory || process.cwd(), client })
    : (pluginFactory && typeof pluginFactory.server === 'function'
      ? await pluginFactory.server({ directory: options.directory || process.cwd(), client })
      : (pluginFactory || {}));
  return {
    plugin,
    client,
    pluginHost: createUniversalOpenCodeHost({ ...options, plugins: options.plugins || [] }),
    async invoke(lifecycle, event, invokeOptions = {}) {
      const input = toOpenCodePluginInput(event, { ...options, client });
      const hooks = HOOK_MAP[lifecycle] || [lifecycle];
      const results = [];
      for (const hookName of hooks) {
        results.push(await invokeOmoHook(hookName, input, { ...options, ...invokeOptions, hooks: plugin, enabled: invokeOptions.enabled ?? options.enabled }));
      }
      return results;
    },
  };
}

module.exports = {
  APPROVED_EFFECT_KINDS,
  DEFAULT_PHASE_TIMEOUT_MS,
  TRUST_ORDER,
  createOpenCodeCompatPlugin,
  createOpenCodeHost,
  createUniversalOpenCodeHost,
};
