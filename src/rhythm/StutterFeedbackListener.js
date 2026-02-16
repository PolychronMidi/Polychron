// src/rhythm/StutterFeedbackListener.js - EventBus listener for stutter → Rhythm feedback loops
// Mirrors FXFeedbackListener but accumulates stutter activity (CC + note) so
// rhythm/dynamism systems can respond to stutter intensity.

StutterFeedbackListener = (() => {
  let stutterAccumulator = 0; // cumulative stutter intensity (global)
  const perProfile = { source: 0, reflection: 0, bass: 0 };
  const decayRate = 0.9;        // decay per cycle
  let initialized = false;

  function initialize() {
    if (initialized) return;
    if (typeof EventBus === 'undefined') {
      throw new Error('StutterFeedbackListener.initialize: EventBus not available');
    }

    EventBus.on('stutter-applied', (data) => {
      try {
        if (!data || typeof data !== 'object') throw new Error('StutterFeedbackListener: event payload must be an object');
        const intensity = Number.isFinite(Number(data.intensity)) ? Number(data.intensity) : 0;
        const profile = (data && typeof data.profile === 'string') ? data.profile : 'unknown';
        // give note stutters slightly more weight than CC-only events
        const weight = (data && data.type === 'note') ? 1.0 : 0.8;
        const contrib = clamp(intensity * weight, 0, 1);
        stutterAccumulator = stutterAccumulator * decayRate + contrib * (1 - decayRate);
        if (profile && perProfile[profile] !== undefined) {
          perProfile[profile] = perProfile[profile] * decayRate + contrib * (1 - decayRate);
        }
      } catch (e) {
        throw new Error(`StutterFeedbackListener event error: ${e && e.message ? e.message : e}`);
      }
    });

    EventBus.on('section-boundary', () => {
      stutterAccumulator = 0;
      Object.keys(perProfile).forEach(k => perProfile[k] = 0);
    });

    initialized = true;
  }

  function getIntensity(profile = null) {
    if (profile && perProfile[profile] !== undefined) return clamp(perProfile[profile], 0, 1);
    return clamp(stutterAccumulator, 0, 1);
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

  function decay() { stutterAccumulator *= decayRate; Object.keys(perProfile).forEach(k => perProfile[k] *= decayRate); }
  function reset() { stutterAccumulator = 0; Object.keys(perProfile).forEach(k => perProfile[k] = 0); }

  return {
    initialize,
    getIntensity,
    biasRhythmWeights,
    decay,
    reset
  };
})();
