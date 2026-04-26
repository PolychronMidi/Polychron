// src/rhythm/stutterFeedbackListener.js - eventBus listener for stutter - Rhythm feedback loops
// Mirrors FXFeedbackListener but accumulates stutter activity (CC + note) so
// rhythm/dynamism systems can respond to stutter intensity.

moduleLifecycle.declare({
  name: 'stutterFeedbackListener',
  subsystem: 'rhythm',
  deps: ['validator'],
  provides: ['stutterFeedbackListener'],
  init: (deps) => {
  const V = deps.validator.create('stutterFeedbackListener');

  let accumulator = null;
  const perProfile = { source: 0, reflection: 0, bass: 0 };
  const decayRate = 0.9;
  let initialized = false;

  function ensureAccumulator() {
    if (accumulator) return accumulator;
    V.requireDefined(feedbackAccumulator, 'feedbackAccumulator');
    const EVENTS = V.getEventsOrThrow();

    accumulator = feedbackAccumulator.create({
      name: 'stutter-feedback',
      decayRate,
      inputs: [
        {
          eventName: EVENTS.STUTTER_APPLIED,
          project(data) {
            const weight = data.type === 'note' ? 1.0 : 0.8;
            return clamp(data.intensity * weight, 0, 1);
          }
        }
      ],
      onInput(data, contribution) {
        const profile = data.profile;
        V.assertNonEmptyString(profile, 'profile');
        // Per-layer accumulation: only update if event layer matches active layer
        const eventLayer = data.layer || 'L1';
        const currentLayer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
        if (eventLayer === currentLayer && profile && perProfile[profile] !== undefined) {
          perProfile[profile] = perProfile[profile] * decayRate + contribution * (1 - decayRate);
        }
      },
      onReset() {
        Object.keys(perProfile).forEach(k => perProfile[k] = 0);
      }
    });

    return accumulator;
  }

  function initialize() {
    if (initialized) return;
    ensureAccumulator().initialize();

    initialized = true;
  }

  function getIntensity(profile = null) {
    if (profile && perProfile[profile] !== undefined) return clamp(perProfile[profile], 0, 1);
    if (!initialized || !accumulator) {
      throw new Error('stutterFeedbackListener.getIntensity: listener not initialized');
    }
    return accumulator.getIntensity();
  }

  // Small, conservative rhythm-weight bias based on stutter intensity
  function biasRhythmWeights(rhythmsObj, profile = null) {
    V.assertObject(rhythmsObj, 'rhythmsObj');

    const intensity = getIntensity(profile);
    const modified = {};

    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) { modified[key] = spec; continue; } // eslint-disable-line local/prefer-validator

      // method multiplier: small sway ( ~12%) so stutter subtly nudges rhythm choice
      const methodMultiplier = 1 + (intensity - 0.5) * 0.25;

      const newWeights = spec.weights.map((w, idx) => {
        const wN = V.optionalFinite(Number(w), 0.1);
        const complexity = idx / spec.weights.length; // 0=simple, 1=complex
        const complexityBoost = (complexity - 0.5) * intensity * 0.2;
        const adjusted = (wN + complexityBoost) * methodMultiplier;
        return m.max(0.1, adjusted);
      });

      modified[key] = { ...spec, weights: newWeights };
    }

    return modified;
  }

  function decay() {
    if (!accumulator) throw new Error('stutterFeedbackListener.decay: accumulator not initialized');
    accumulator.decay();
    Object.keys(perProfile).forEach(k => perProfile[k] *= decayRate);
  }

  function reset() {
    if (!accumulator) throw new Error('stutterFeedbackListener.reset: accumulator not initialized');
    accumulator.reset();
    Object.keys(perProfile).forEach(k => perProfile[k] = 0);
  }


  return {
    initialize,
    getIntensity,
    biasRhythmWeights,
    decay,
    reset
  };
  },
});
