// src/rhythm/DrumTextureCoupler.js - EventBus listener coupling texture contrast events to drum accenting
// When TextureBlender fires chord bursts or flurries, this listener accumulates
// intensity and exposes it so drum patterns can accent in sympathy.

DrumTextureCoupler = (() => {
  let accumulator = 0;
  const decayRate = 0.88;       // Faster decay than FX feedback — texture events are transient
  let burstCount = 0;
  let flurryCount = 0;
  let initialized = false;

  /**
   * Initialize: wire EventBus to listen for texture-contrast events.
   * @throws {Error} if EventBus not available
   */
  function initialize() {
    if (initialized) return;
    if (typeof EventBus === 'undefined') {
      throw new Error('DrumTextureCoupler.initialize: EventBus not available');
    }

    EventBus.on('texture-contrast', (data) => {
      try {
        if (!data || typeof data !== 'object') throw new Error('DrumTextureCoupler: event payload must be an object');
        const composite = Number.isFinite(Number(data.composite)) ? Number(data.composite) : 0;
        const mode = data.mode || 'single';

        // Weight by mode: bursts are percussive → stronger drum response
        const weight = mode === 'chordBurst' ? 0.7 : mode === 'flurry' ? 0.4 : 0;
        const intensity = weight * (0.5 + composite * 0.5);
        if (!Number.isFinite(intensity)) {
          throw new Error(`DrumTextureCoupler: invalid intensity ${intensity}`);
        }

        accumulator = accumulator * decayRate + intensity * (1 - decayRate);
        if (mode === 'chordBurst') burstCount++;
        if (mode === 'flurry') flurryCount++;
      } catch (e) {
        throw new Error(`DrumTextureCoupler event error: ${e && e.message ? e.message : e}`);
      }
    });

    // Reset at section boundary (matches FXFeedbackListener pattern)
    EventBus.on('section-boundary', () => {
      accumulator = 0;
      burstCount = 0;
      flurryCount = 0;
    });

    initialized = true;
  }

  /**
   * Get current texture-drum coupling intensity (0-1).
   * Higher values mean more recent texture contrast events → drums should accent.
   * @returns {number}
   */
  function getIntensity() {
    return clamp(accumulator, 0, 1);
  }

  /**
   * Whether drums should accent the current beat based on recent texture activity.
   * Returns true when intensity crosses a rising threshold with jitter.
   * @returns {boolean}
   */
  function shouldAccent() {
    return accumulator > rf(0.15, 0.35);
  }

  /**
   * Get counts for diagnostics/metrics.
   * @returns {{ burstCount: number, flurryCount: number, intensity: number }}
   */
  function getMetrics() {
    return { burstCount, flurryCount, intensity: clamp(accumulator, 0, 1) };
  }

  return {
    initialize,
    getIntensity,
    shouldAccent,
    getMetrics
  };
})();
