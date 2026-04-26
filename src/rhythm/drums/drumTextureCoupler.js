// src/rhythm/drumTextureCoupler.js - eventBus listener coupling texture contrast events to drum accenting
// When textureBlender fires chord bursts or flurries, this listener accumulates
// intensity and exposes it so drum patterns can accent in sympathy.

moduleLifecycle.declare({
  name: 'drumTextureCoupler',
  subsystem: 'rhythm',
  // Full DI: feedbackAccumulator referenced inside ensureFeedback(); flow
  // through deps so init runs only after feedbackAccumulator is bound.
  deps: ['feedbackAccumulator', 'regimeClassifier', 'validator'],
  provides: ['drumTextureCoupler'],
  init: (deps) => {
  const feedbackAccumulator = deps.feedbackAccumulator;
  const regimeClassifier = deps.regimeClassifier;
  const V = deps.validator.create('drumTextureCoupler');

  let feedback = null;
  const decayRate = 0.88;
  let burstCount = 0;
  let flurryCount = 0;
  let initialized = false;

  function ensureFeedback() {
    if (feedback) return feedback;
    V.requireDefined(feedbackAccumulator, 'feedbackAccumulator');
    const EVENTS = V.getEventsOrThrow();

    feedback = feedbackAccumulator.create({
      name: 'drum-texture-coupler',
      decayRate,
      inputs: [
        {
          eventName: EVENTS.TEXTURE_CONTRAST,
          project(data) {
            const composite = V.requireFinite(data.composite, 'texture-contrast.composite');
            V.assertNonEmptyString(data.mode, 'texture-contrast.mode');
            const mode = data.mode;
            const weight = mode === 'chordBurst' ? 0.7 : mode === 'flurry' ? 0.4 : 0;
            const intensity = weight * (0.5 + composite * 0.5);
            V.requireFinite(intensity, 'intensity');
            return clamp(intensity, 0, 1);
          }
        }
      ],
      onInput(data) {
        V.assertNonEmptyString(data.mode, 'texture-contrast.mode');
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
   * Initialize: wire eventBus to listen for texture-contrast events.
   * @throws {Error} if eventBus not available
   */
  function initialize() {
    if (initialized) return;
    ensureFeedback().initialize();

    initialized = true;
  }

  /**
   * Get current texture-drum coupling intensity (0-1).
   * Higher values mean more recent texture contrast events - drums should accent.
   * @returns {number}
   */
  function getIntensity() {
    if (!initialized || !feedback) {
      throw new Error('drumTextureCoupler.getIntensity: listener not initialized');
    }
    return feedback.getIntensity();
  }

  /**
   * Whether drums should accent the current beat based on recent texture activity.
   * Returns true when intensity crosses a rising threshold with jitter.
   * @returns {boolean}
   */
  // R79 E3: Regime-aware accent threshold. In exploring regime, lower
  // threshold (0.10-0.28) makes drums accent more readily in response to
  // texture events -- punctuated, responsive rhythmic texture. In coherent
  // regime, higher threshold (0.22-0.42) means only strong texture events
  // trigger accents -- fewer but more impactful rhythmic punctuation.
  function shouldAccent() {
    const intensity = getIntensity();
    const regime = regimeClassifier.getRegime();
    const threshold = regime === 'exploring' ? rf(0.10, 0.28)
      : regime === 'coherent' ? rf(0.22, 0.42)
      : rf(0.15, 0.35);
    return intensity > threshold;
  }

  /**
   * Get counts for diagnostics/metrics.
   * @returns {{ burstCount: number, flurryCount: number, intensity: number }}
   */
  function getMetrics() {
    return { burstCount, flurryCount, intensity: getIntensity() };
  }


  // Full DI: feedbackAccumulator is bound, run wiring inline.
  initialize();
  return {
    getIntensity,
    shouldAccent,
    getMetrics
  };
  },
});
