// TextureBlender.js — Per-unit texture mode selector for contrast-blend oscillations.
// Decides whether a unit should emit normally ('single'), fire a percussive
// chord stab ('chordBurst'), or inject a rapid scalar flurry ('flurry').
// Probabilities oscillate using micro-hyper technique so texture switching
// never settles into a predictable pattern.
// Integrations: Stutter coupling (#1), Phrase arc fatigue tracking (#3).

TextureBlender = (() => {
  const V = Validator.create('TextureBlender');
  // ── Fatigue tracking: rolling window of recent decisions (#3) ──
  const FATIGUE_WINDOW = 12;
  const recentModes = [];

  /**
   * Return a fatigue multiplier for a given mode (1 = fresh, 0.2 = heavily fatigued).
   * Repeated use of the same mode within the rolling window decays probability.
   * @param {string} mode
   * @returns {number}
   */
  function getFatigue(mode) {
    let count = 0;
    for (let i = 0; i < recentModes.length; i++) {
      if (recentModes[i] === mode) count++;
    }
    return m.max(0.2, 1 - count * 0.15);
  }

  /** Push a mode into the rolling window, evicting oldest if full. */
  function recordMode(mode) {
    recentModes.push(mode);
    if (recentModes.length > FATIGUE_WINDOW) recentModes.shift();
  }

  function getRecentDensity() {
    if (recentModes.length === 0) return 0;
    let weighted = 0;
    for (let i = 0; i < recentModes.length; i++) {
      weighted += recentModes[i] === 'chordBurst' ? 1 : recentModes[i] === 'flurry' ? 0.7 : 0;
    }
    return clamp(weighted / recentModes.length, 0, 1);
  }

  /**
   * Get phrase-position influence on texture probabilities (#3).
   * Openings favour 'single' to let melody establish; climaxes boost textures;
   * resolutions allow bursts but suppress flurries.
   * @returns {{ burstBias: number, flurryBias: number }}
   */
  function getPhraseTextureInfluence() {
    const state = ConductorState.getSnapshot();
    const pos = V.requireFinite(state.phrasePosition, 'state.phrasePosition');
    const phase = state.phrasePhase ?? '';
    const atStart = pos <= 0.001;
    const atEnd = pos >= 0.999;
    if (atStart || phase === 'opening') return { burstBias: 0.3, flurryBias: 0.4 };
    if (phase === 'climax' || phase === 'peak') return { burstBias: 1.6, flurryBias: 1.4 };
    if (atEnd || phase === 'resolution') return { burstBias: 1.2, flurryBias: 0.5 };
    return { burstBias: 0.7 + pos * 0.8, flurryBias: 0.8 + (1 - pos) * 0.6 };
  }

  /**
   * Stutter coupling (#1): if stutter has selected channels, suppress chord
   * bursts (they rhythmically clash with stutter octave jumps) and bias toward
   * flurry for complementary melodic dialogue.
   * @returns {{ burstSuppression: number, flurryBoost: number }}
   */
  function getStutterCoupling() {
    if (Stutter && Stutter.beatContext) {
      const bc = Stutter.beatContext;
      const hasReflection = bc.selectedReflectionChannels && bc.selectedReflectionChannels.size > 0;
      const hasBass = bc.selectedBassChannels && bc.selectedBassChannels.size > 0;
      if (hasReflection || hasBass) {
        return { burstSuppression: 0.35, flurryBoost: 1.3 };
      }
    }
    return { burstSuppression: 1, flurryBoost: 1 };
  }

  /**
   * Resolve the texture mode for a given unit invocation.
   * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
   * @param {number} composite - DynamismEngine composite intensity (0-1)
   * @returns {{ mode: 'single'|'chordBurst'|'flurry', velocityScale: number, sustainScale: number }}
   */
  function resolve(unit, composite) {
    if (typeof unit !== 'string' || unit.length === 0) {
      throw new Error('TextureBlender.resolve: unit must be a non-empty string');
    }
    if (!Number.isFinite(composite)) {
      throw new Error('TextureBlender.resolve: composite must be a finite number');
    }

    // ── Oscillating probability seeds ──────────────────────────────
    const seed = Number.isFinite(unitStart) ? unitStart : beatStart;
    const unitDepth = unit === 'beat' ? 0 : unit === 'div' ? 1 : unit === 'subdiv' ? 2 : 3;

    const oscA = (m.sin(seed * 0.0023 + unitDepth * 3.7) + 1) * 0.5;
    const oscB = (m.sin(seed * 0.0059 - unitDepth * 5.3) + 1) * 0.5;
    const oscBlend = oscA * 0.6 + oscB * 0.4;

    const crossModFactor = clamp(crossModulation / 6, 0, 1);

    // ── Context-aware modulation (#1 + #3) ─────────────────────────
    const phraseInfluence = getPhraseTextureInfluence();
    const stutterCoupling = getStutterCoupling();
    const burstFatigue = getFatigue('chordBurst');
    const flurryFatigue = getFatigue('flurry');

    // ── Chord burst probability ────────────────────────────────────
    const texCfg = ConductorConfig.getTextureScaling();
    const burstBaseRaw = unit === 'beat' ? 0.02 : unit === 'div' ? 0.06 : unit === 'subdiv' ? 0.10 : 0.08;
    const burstBase = burstBaseRaw * texCfg.burstBaseScale;
    const burstProb = clamp(
      burstBase * (0.3 + composite * 1.5) * (0.6 + oscBlend * 0.8) * (0.7 + crossModFactor * 0.6)
        * phraseInfluence.burstBias * stutterCoupling.burstSuppression * burstFatigue,
      0,
      texCfg.burstCap
    );

    // ── Flurry probability ─────────────────────────────────────────────
    const flurryBaseRaw = unit === 'beat' ? 0.03 : unit === 'div' ? 0.08 : unit === 'subdiv' ? 0.06 : 0.04;
    const flurryBase = flurryBaseRaw * texCfg.flurryBaseScale;
    const invertedComposite = 1 - composite;
    const flurryProb = clamp(
      flurryBase * (0.3 + invertedComposite * 1.5) * (0.5 + (1 - oscBlend) * 1.0) * (0.7 + crossModFactor * 0.6)
        * phraseInfluence.flurryBias * stutterCoupling.flurryBoost * flurryFatigue,
      0,
      texCfg.flurryCap
    );

    // ── Roll the dice ──────────────────────────────────────────────
    const roll = rf();
    if (roll < burstProb) {
      /** @type {{ mode: 'chordBurst'|'flurry'|'single', velocityScale: number, sustainScale: number }} */
      const result = {
        mode: 'chordBurst',
        velocityScale: clamp(0.75 + composite * 0.3 + rf(-0.05, 0.05), 0.5, 1.2),
        sustainScale: clamp(0.15 + (1 - composite) * 0.25, 0.1, 0.5)
      };
      recordMode(result.mode);
      return result;
    } else if (roll < burstProb + flurryProb) {
      /** @type {{ mode: 'chordBurst'|'flurry'|'single', velocityScale: number, sustainScale: number }} */
      const result = {
        mode: 'flurry',
        velocityScale: clamp(0.65 + invertedComposite * 0.25 + rf(-0.05, 0.05), 0.4, 1.0),
        sustainScale: clamp(0.1 + composite * 0.15, 0.08, 0.3)
      };
      recordMode(result.mode);
      return result;
    } else {
      /** @type {{ mode: 'chordBurst'|'flurry'|'single', velocityScale: number, sustainScale: number }} */
      const result = { mode: 'single', velocityScale: 1, sustainScale: 1 };
      recordMode(result.mode);
      return result;
    }
  }

  return {
    resolve,
    getRecentDensity
  };
})();
