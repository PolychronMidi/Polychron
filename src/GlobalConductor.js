// GlobalConductor.js - Orchestrates system-wide coherence and dynamicism
// Readings from HarmonincContext and PhraseArcManager drive:
// - Motif density (via motifConfig overrides)
// - Stutter intensity/rate (via StutterManager directives)
// - Play probabilities (returned to main loop)

GlobalConductor = (() => {
  // State for smoothing transitions
  let currentDensity = 0.5;

  /**
   * Update all dynamic systems based on current musical context.
   * Call once per beat (or measure) from main loop.
   * @returns {{ playProb: number, stutterProb: number }}
   */
  function update() {
    // 1. gather context
    const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager)
      ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
      : { dynamism: 0.7, position: 0.5, atStart: false, atEnd: false };

    // Safety check for HarmonicContext
    const harmonicTension = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('tension') || 0)
      : 0;

    // READ NEW CONTEXT: Structural Phase & Excursion
    // These drive macro-dynamics (long-term arcs) vs phraseCtx (mid-term)
    const sectionPhase = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('sectionPhase'))
      || 'development';
    const excursion = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('excursion'))
      || 0;

    // 2. derive composite intensity (0-1)
    // Intensity rises with phrase position, harmonic tension, and structural drama
    const arcIntensity = phraseCtx.dynamism * (0.5 + 0.5 * phraseCtx.position);

    // Calculate Phase Multiplier
    // climax -> 1.3x, resolution -> 0.7x, etc.
    let phaseMult = 1.0;
    if (sectionPhase === 'climax') phaseMult = 1.3;
    else if (sectionPhase === 'resolution') phaseMult = 0.7;
    else if (sectionPhase === 'intro') phaseMult = 0.8;

    // Calculate Excursion Tension (0-6 semitones -> 0-0.3)
    // Further from home = more unstable/intense
    const excursionTension = Math.min(excursion, 6) * 0.05;

    const tensionIntensity = harmonicTension + excursionTension;
    const compositeIntensity = clamp((arcIntensity * 0.6 + tensionIntensity * 0.4) * phaseMult, 0, 1);

    // 3. Drive Motif Density (Coherence: High tension -> denser motifs)
    // Smoothly interpolate towards target density
    const targetDensity = 0.3 + 0.5 * compositeIntensity; // range 0.3 - 0.8
    currentDensity = currentDensity * 0.8 + targetDensity * 0.2; // simple low-pass filter

    if (typeof motifConfig !== 'undefined' && typeof motifConfig.setUnitProfileOverride === 'function') {
      // Apply density to deeper units for texture buildup
      motifConfig.setUnitProfileOverride('div', { intervalDensity: currentDensity });
      motifConfig.setUnitProfileOverride('subdiv', { intervalDensity: currentDensity * 0.9 });
      motifConfig.setUnitProfileOverride('subsubdiv', { intervalDensity: currentDensity * 0.8 });
    }

    // 4. Drive Stutter Behavior (Dynamicism: High intensity -> faster, more chaotic stutters)
    if (typeof Stutter !== 'undefined') {
      // Modulate rate based on tension
      let rateBase = 8;
      if (compositeIntensity > 0.8 || sectionPhase === 'climax') rateBase = 32;
      else if (compositeIntensity > 0.5) rateBase = 16;

      const rateCurve = compositeIntensity > 0.6 ? 'exp' : 'linear';

      // Update default directive for spontaneous stutters
      if (typeof Stutter.setDefaultDirective === 'function') {
        Stutter.setDefaultDirective({
          rate: rateBase,
          rateCurve: rateCurve,
          phase: {
            left: 0,
            right: 0.5 + 0.2 * compositeIntensity, // winder stereo width with intensity
            center: 0
          },
          coherence: {
            enabled: true, // Always enable coherence for musicality
            mode: compositeIntensity > 0.8 ? 'loose' : 'tight'
          }
        });
      }
    }

    // 5. Calculate Return Probs (for main.js loop control)
    const dynScale = DYNAMISM.scaleBase + phraseCtx.dynamism * DYNAMISM.scaleRange;
    const basePlayProb = phraseCtx.atStart ? DYNAMISM.playProb.start : DYNAMISM.playProb.mid;

    // Stutter prob increases significantly with tension AND excursion
    const tensionBonus = (harmonicTension * 0.3) + (excursion * 0.05);
    const baseStutterProb = (phraseCtx.atEnd ? DYNAMISM.stutterProb.end : DYNAMISM.stutterProb.mid) + tensionBonus;

    if (sectionPhase === 'climax') {
        // Boost stutter and play probability in climax
        return {
            playProb: clamp(basePlayProb * dynScale * 1.2, 0, 1),
            stutterProb: clamp(baseStutterProb * dynScale * 1.5, 0, 1)
        };
    }

    return {
      playProb: clamp(basePlayProb * dynScale, 0, 1),
      stutterProb: clamp(baseStutterProb * dynScale, 0, 1)
    };
  }

  return { update };
})();
