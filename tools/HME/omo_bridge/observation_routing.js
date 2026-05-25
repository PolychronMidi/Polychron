const { assertUniversalEvent } = require('./universal_event');

const OBSERVATION_PHASES = Object.freeze([
  'session.start',
  'session.end',
  'message.input',
  'message.output',
  'tool.execute.after',
  'telemetry.event',
]);

function emitSafe(emit, event, payload) {
  if (typeof emit === 'function') emit(event, payload);
}

async function routeObservationEvent(universalEvent, options = {}) {
  const event = assertUniversalEvent(universalEvent);
  if (!OBSERVATION_PHASES.includes(event.phase)) return { routed: false, reason: 'not_observation_phase', liveDecisionChanged: false };
  const emit = options.emit;
  if (!options.pluginHost || options.enabled === false) {
    emitSafe(emit, 'universal_hook.observation_skipped', { phase: event.phase, host: event.source.host });
    return { routed: true, skipped: true, liveDecisionChanged: false, effects: [] };
  }
  try {
    const result = await options.pluginHost.invokePhase(event, { host: options.host || event.source.host, enabled: true });
    const safeEffects = (result.effects || []).filter((effect) => ['telemetry', 'log', 'counter'].includes(effect.kind));
    emitSafe(emit, 'universal_hook.observation_routed', { phase: event.phase, host: event.source.host, effects: safeEffects.length });
    return { routed: true, liveDecisionChanged: false, primaryDecision: { kind: 'allow' }, effects: safeEffects, pluginResult: result };
  } catch (error) {
    emitSafe(emit, 'universal_hook.observation_error', { phase: event.phase, host: event.source.host, error: error.message });
    return { routed: true, liveDecisionChanged: false, primaryDecision: { kind: 'allow' }, effects: [], error: error.message };
  }
}

module.exports = { OBSERVATION_PHASES, routeObservationEvent };
