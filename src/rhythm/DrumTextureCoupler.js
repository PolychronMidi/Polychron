// src/rhythm/DrumTextureCoupler.js - EventBus listener coupling texture contrast events to drum accenting
// When TextureBlender fires chord bursts or flurries, this listener accumulates
// intensity and exposes it so drum patterns can accent in sympathy.

DrumTextureCoupler = (() => {
  const V = Validator.create('DrumTextureCoupler');

  let feedback = null;
  const decayRate = 0.88;
  let burstCount = 0;
  let flurryCount = 0;
  let initialized = false;

  function ensureFeedback() {
    if (feedback) return feedback;
    V.requireDefined(FeedbackAccumulator, 'FeedbackAccumulator');
    if (typeof FeedbackAccumulator.create !== 'function') {
      throw new Error('DrumTextureCoupler: FeedbackAccumulator.create is required');
    }
    const EVENTS = V.getEventsOrThrow();

    feedback = FeedbackAccumulator.create({
      name: 'drum-texture-coupler',
      decayRate,
      inputs: [
        {
          eventName: EVENTS.TEXTURE_CONTRAST,
          project(data) {
            if (!data || typeof data !== 'object') throw new Error('DrumTextureCoupler: event payload must be an object');
            const composite = Number(data.composite);
            if (!Number.isFinite(composite)) {
              throw new Error('DrumTextureCoupler: texture-contrast.composite must be finite');
            }
            if (typeof data.mode !== 'string' || data.mode.length === 0) {
              throw new Error('DrumTextureCoupler: texture-contrast.mode must be a non-empty string');
            }
            const mode = data.mode;
            const weight = mode === 'chordBurst' ? 0.7 : mode === 'flurry' ? 0.4 : 0;
            const intensity = weight * (0.5 + composite * 0.5);
            if (!Number.isFinite(intensity)) {
              throw new Error(`DrumTextureCoupler: invalid intensity ${intensity}`);
            }
            return clamp(intensity, 0, 1);
          }
        }
      ],
      onInput(data) {
        if (!data || typeof data !== 'object') {
          throw new Error('DrumTextureCoupler: onInput payload must be an object');
        }
        if (typeof data.mode !== 'string' || data.mode.length === 0) {
          throw new Error('DrumTextureCoupler: texture-contrast.mode must be a non-empty string');
        }
        const mode = data.mode;
        if (mode === 'chordBurst') burstCount++;
        if (mode === 'flurry') flurryCount++;
      },
      onReset() {
        burstCount = 0;
        flurryCount = 0;
      }
    });

    return feedback;
  }

  /**
   * Initialize: wire EventBus to listen for texture-contrast events.
   * @throws {Error} if EventBus not available
   */
  function initialize() {
    if (initialized) return;
    ensureFeedback().initialize();

    initialized = true;
  }

  /**
   * Get current texture-drum coupling intensity (0-1).
   * Higher values mean more recent texture contrast events → drums should accent.
   * @returns {number}
   */
  function getIntensity() {
    if (!initialized || !feedback) {
      throw new Error('DrumTextureCoupler.getIntensity: listener not initialized');
    }
    return feedback.getIntensity();
  }

  /**
   * Whether drums should accent the current beat based on recent texture activity.
   * Returns true when intensity crosses a rising threshold with jitter.
   * @returns {boolean}
   */
  function shouldAccent() {
    const intensity = getIntensity();
    return intensity > rf(0.15, 0.35);
  }

  /**
   * Get counts for diagnostics/metrics.
   * @returns {{ burstCount: number, flurryCount: number, intensity: number }}
   */
  function getMetrics() {
    return { burstCount, flurryCount, intensity: getIntensity() };
  }

  return {
    initialize,
    getIntensity,
    shouldAccent,
    getMetrics
  };
})();
