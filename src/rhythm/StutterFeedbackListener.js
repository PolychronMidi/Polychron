// src/rhythm/StutterFeedbackListener.js - EventBus listener for stutter → Rhythm feedback loops
// Mirrors FXFeedbackListener but accumulates stutter activity (CC + note) so
// rhythm/dynamism systems can respond to stutter intensity.

StutterFeedbackListener = (() => {
  const V = Validator.create('StutterFeedbackListener');

  let accumulator = null;
  const perProfile = { source: 0, reflection: 0, bass: 0 };
  const decayRate = 0.9;
  let initialized = false;

  function ensureAccumulator() {
    if (accumulator) return accumulator;
    V.requireDefined(FeedbackAccumulator, 'FeedbackAccumulator');
    const EVENTS = V.getEventsOrThrow();

    accumulator = FeedbackAccumulator.create({
      name: 'stutter-feedback',
      decayRate,
      inputs: [
        {
          eventName: EVENTS.STUTTER_APPLIED,
          project(data) {
            V.assertObject(data, 'stutter-applied payload');
            const intensity = V.requireFinite(data.intensity, 'stutter-applied.intensity');
            V.assertNonEmptyString(data.type, 'stutter-applied.type');
            const weight = data.type === 'note' ? 1.0 : 0.8;
            return clamp(intensity * weight, 0, 1);
          }
        }
      ],
      onInput(data, contribution) {
        const profile = data.profile;
        if (typeof profile !== 'string' || profile.length === 0) {
          throw new Error('StutterFeedbackListener: stutter-applied.profile must be a non-empty string');
        }
        if (profile && perProfile[profile] !== undefined) {
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
      throw new Error('StutterFeedbackListener.getIntensity: listener not initialized');
    }
    return accumulator.getIntensity();
  }

  // Small, conservative rhythm-weight bias based on stutter intensity
  function biasRhythmWeights(rhythmsObj, profile = null) {
    if (!rhythmsObj || typeof rhythmsObj !== 'object') {
      throw new Error('StutterFeedbackListener.biasRhythmWeights: invalid rhythms object');
    }

    const intensity = getIntensity(profile);
    const modified = {};

    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) {
        modified[key] = spec;
        continue;
      }

      // method multiplier: small sway (+/- ~12%) so stutter subtly nudges rhythm choice
      const methodMultiplier = 1 + (intensity - 0.5) * 0.25;

      const newWeights = spec.weights.map((w, idx) => {
        const wN = Number.isFinite(Number(w)) ? Number(w) : 0.1;
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
    if (!accumulator) return;
    accumulator.decay();
    Object.keys(perProfile).forEach(k => perProfile[k] *= decayRate);
  }

  function reset() {
    if (!accumulator) return;
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
})();
