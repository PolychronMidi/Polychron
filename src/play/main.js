// main.js - Main composition engine orchestrating section, phrase, measure hierarchy.
require('../index');

main = async function main() { console.log('Starting main.js ...');

const { layer: L1 } = LM.register('L1', 'c1', {}, () => setTuningAndInstruments());
const { layer: L2 } = LM.register('L2', 'c2', {}, () => setTuningAndInstruments());

// Create composer context for explicit dependency passing (fail-fast: throw if managers missing)
const composerCtx = {
  phraseArc: ComposerFactory.getPhraseArcManager(),
  layerMgr: typeof LM !== 'undefined' ? LM : (() => { throw new Error('main: LayerManager (LM) not available'); })(),
  rhythmMgr: typeof RhythmRegistry !== 'undefined' ? RhythmRegistry : (() => { throw new Error('main: RhythmRegistry not available'); })(),
  stutterMgr: typeof Stutter !== 'undefined' ? Stutter : (() => { throw new Error('main: Stutter not available'); })(),
  eventBus: typeof EventBus !== 'undefined' ? EventBus : (() => { throw new Error('main: EventBus not available'); })(),
  harmonicCtx: typeof HarmonicContext !== 'undefined' ? HarmonicContext : (() => { throw new Error('main: HarmonicContext not available'); })(),
  motifChain: typeof MotifChain !== 'undefined' ? MotifChain : (() => { throw new Error('main: MotifChain not available'); })(),

  /**
   * Context-aware family selection hook: biases family weights by structural phase.
   * Called from factoryFamilies.resolvePhraseFamilyOrFail when no explicit family is requested.
   * @param {{availableFamilies: string[], sectionIndex: number|null, phraseIndex: number|null}} info
   * @returns {string|null} family name or null for default weighted random
   */
  selectPhraseFamily({ availableFamilies }) {
    if (!Array.isArray(availableFamilies) || availableFamilies.length === 0) return null;
    const phase = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('sectionPhase') || 'development')
      : 'development';

    // Phase-based family affinity — return a preferred family when structurally appropriate
    const phaseAffinity = {
      intro: 'diatonicCore',
      opening: 'diatonicCore',
      development: 'development',
      climax: 'rhythmicDrive',
      resolution: 'harmonicMotion',
      conclusion: 'tonalExploration'
    };
    const preferred = phaseAffinity[phase];
    // Only bias if the preferred family exists; otherwise fall through to weighted random
    if (preferred && availableFamilies.includes(preferred)) {
      // 50% chance to lock onto the phase-preferred family; 50% to let weighted random decide
      if (rf() < 0.5) return preferred;
    }
    return null;
  }
};
ComposerFactory.setComposerContext(composerCtx);

const selectLayerComposerForMeasure = (layerName, phraseFamily) => {
  if (typeof layerName !== 'string' || layerName.length === 0) {
    throw new Error('main.selectLayerComposerForMeasure: layerName must be a non-empty string');
  }
  if (typeof phraseFamily !== 'string' || phraseFamily.length === 0) {
    throw new Error('main.selectLayerComposerForMeasure: phraseFamily must be a non-empty string');
  }
  const peerLayerName = layerName === 'L1' ? 'L2' : (layerName === 'L2' ? 'L1' : null);
  const previousComposer = (LM.layerComposers && LM.layerComposers[layerName] && typeof LM.layerComposers[layerName] === 'object')
    ? LM.layerComposers[layerName]
    : null;
  const peerComposer = (peerLayerName && LM.layerComposers && LM.layerComposers[peerLayerName] && typeof LM.layerComposers[peerLayerName] === 'object')
    ? LM.layerComposers[peerLayerName]
    : null;

  const nextComposer = ComposerFactory.createRandomForLayer({
    familyName: phraseFamily,
    layerName,
    previousComposer,
    peerComposer,
    extraConfig: { root: 'random' }
  }, composerCtx);

  LM.setComposerFor(layerName, nextComposer);
  return nextComposer;
};

// Initialize EventBus feedback loop: FX intensity → rhythm pattern modulation
if (typeof FXFeedbackListener !== 'undefined') {
  FXFeedbackListener.initialize();
}
// Initialize stutter → rhythm feedback (new)
if (typeof StutterFeedbackListener !== 'undefined') {
  StutterFeedbackListener.initialize();
}
// Initialize journey → rhythm coupling: bold key moves → complex rhythms
if (typeof JourneyRhythmCoupler !== 'undefined') {
  JourneyRhythmCoupler.initialize();
}
// Initialize texture contrast → drum accent coupling (#5)
if (typeof DrumTextureCoupler !== 'undefined') {
  DrumTextureCoupler.initialize();
}

totalSections = ri(SECTIONS.min, SECTIONS.max);

// Plan the harmonic journey across all sections
if (typeof HarmonicJourney !== 'undefined' && HarmonicJourney && typeof HarmonicJourney.planJourney === 'function') {
  HarmonicJourney.planJourney(totalSections, { startKey: 'random', startMode: 'random' });
}

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  // Emit section boundary event to reset FX feedback accumulator
  EventBus.emit('section-boundary', { sectionIndex });

  // Apply harmonic journey stop for this section (sets HarmonicContext for L1)
  if (typeof HarmonicJourney !== 'undefined' && HarmonicJourney && typeof HarmonicJourney.applyToContext === 'function') {
    HarmonicJourney.applyToContext(sectionIndex);
  }

  // Phase-driven conductor profile: match the conductor's character to the structural moment
  ConductorConfig.applyPhaseProfile();

  // Prepare pivot chord bridge for section transitions with key changes
  if (typeof PivotChordBridge !== 'undefined' && PivotChordBridge && typeof PivotChordBridge.prepareBridge === 'function') {
    PivotChordBridge.prepareBridge(sectionIndex);
  }

  // Initialize each layer's section origin so layer-relative ticks are correct and explicit
  LM.setSectionStartAll();

  // Explicitly log a `section` marker for both layers so Section 1 is present
  // for both `L1` and `L2` outputs. Restore `L1` as active for
  // the phrase loop immediately after logging.
  LM.activate('L1', false);
  setUnitTiming('section');
  // Activate L2 without setting `isPoly` yet (L2 meter isn't known until later)
  LM.activate('L2', false);
  setUnitTiming('section');
  LM.activate('L1', false);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    // Restore L1 harmonic context (may have been overwritten by L2's complement)
    if (typeof HarmonicJourney !== 'undefined' && HarmonicJourney && typeof HarmonicJourney.applyToContext === 'function') {
      HarmonicJourney.applyToContext(sectionIndex);
    }

    const phraseFamily = ComposerFactory.resolvePhraseFamilyOrFail({ root: 'random' }, composerCtx);
    if (!LM || typeof LM.setPhraseFamily !== 'function') {
      throw new Error('main: LayerManager.setPhraseFamily not available');
    }
    LM.setPhraseFamily(phraseFamily);

    const phraseL1Composer = selectLayerComposerForMeasure('L1', phraseFamily);
    selectLayerComposerForMeasure('L2', phraseFamily);
    composer = phraseL1Composer;
    [numerator, denominator] = composer.getMeter();
    // Activate L1 layer first so activation doesn't overwrite freshly computed timing
    LM.activate('L1', false);
    getMidiTiming();
    getPolyrhythm();
    // Initialize polyrhythmic phase coupling after alignment is computed
    if (typeof PhaseLockedRhythmGenerator !== 'undefined') {
      PhaseLockedRhythmGenerator.initializePolyrhythmCoupling('L1', 'L2', measuresPerPhrase1, measuresPerPhrase2);
    }
    measuresPerPhrase = measuresPerPhrase1;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      selectLayerComposerForMeasure('L1', phraseFamily);
      setUnitTiming('measure');

      // Advance conductor crossfade and self-regulation once per measure
      ConductorConfig.tickCrossfade();
      ConductorConfig.regulationTick();

      // main.js - using GlobalConductor for dynamic probabilities
      const conductorCtx = (typeof GlobalConductor !== 'undefined' && GlobalConductor && typeof GlobalConductor.update === 'function')
        ? GlobalConductor.update(measureIndex, -1) // Update measure-scope context
        : { playProb: 0.5, stutterProb: 0.3 };

      let playProb = conductorCtx.playProb;
      let stutterProb = conductorCtx.stutterProb;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        // Refine context per beat for maximum dynamicism
        if (typeof GlobalConductor !== 'undefined' && GlobalConductor && typeof GlobalConductor.update === 'function') {
           const beatCtx = GlobalConductor.update(measureIndex, beatIndex);
           playProb = beatCtx.playProb;
           stutterProb = beatCtx.stutterProb;
        }

        beatCount++;
        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        EventBus.emit('beat-binaural-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex });
        setBalanceAndFX();
        // Apply Stutter default directive for this beat (coherence key, etc.)
        try { if (typeof Stutter !== 'undefined' && Stutter && typeof Stutter.prepareBeat === 'function') Stutter.prepareBeat(beatStart); } catch { /* ignore */ }
        // Capture FX intensity from balance and variation globals (normalized 0-1)
        const fxStereoPan = typeof balOffset === 'number' ? m.abs(balOffset) / 45 : 0;
        const fxVelocityShift = (typeof refVar === 'number' && typeof bassVar === 'number')
          ? m.abs(refVar + bassVar) / 20 : 0;
        EventBus.emit('beat-fx-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex, stereoPan: fxStereoPan, velocityShift: fxVelocityShift });
        playDrums();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        // Run any explicit Stutter plans scheduled for this beat
        try { if (typeof Stutter !== 'undefined' && Stutter && typeof Stutter.runDuePlans === 'function') Stutter.runDuePlans(beatStart); } catch { /* ignore */ }
        playNotes('beat', { playProb, stutterProb });
        microUnitAttenuator.begin('div', divsPerBeat);
        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('div');
          if (divIndex > 0) { playNotes('div', { playProb, stutterProb }); }
          microUnitAttenuator.begin('subdiv', subdivsPerDiv);
          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            if (subdivIndex > 0) { playNotes('subdiv', { playProb, stutterProb }); }
            microUnitAttenuator.begin('subsubdiv', subsubsPerSub);
            for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotes('subsubdiv', { playProb, stutterProb }); }
            }
            microUnitAttenuator.flush();
          }
          microUnitAttenuator.flush();
        }
        microUnitAttenuator.flush();
      }
    }

    // Clean layer state at phrase boundary to prevent state bleeding
    playMotifs.resetLayerState(L1);
    LM.advance('L1', 'phrase');

    LM.activate('L2', true);

    // Apply L2 harmonic complement (complementary key/mode relationship to L1)
    if (typeof HarmonicJourney !== 'undefined' && HarmonicJourney && typeof HarmonicJourney.applyL2ToContext === 'function') {
      HarmonicJourney.applyL2ToContext(sectionIndex);
    }

    getMidiTiming();
    measuresPerPhrase = measuresPerPhrase2;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      selectLayerComposerForMeasure('L2', phraseFamily);
      setUnitTiming('measure');

      // L2 uses GlobalConductor for dynamic probabilities — symmetric with L1
      const conductorCtxL2 = (typeof GlobalConductor !== 'undefined' && GlobalConductor && typeof GlobalConductor.update === 'function')
        ? GlobalConductor.update(measureIndex, -1)
        : { playProb: 0.5, stutterProb: 0.3 };

      let playProb = conductorCtxL2.playProb;
      let stutterProb = conductorCtxL2.stutterProb;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        // Refine context per beat for maximum dynamicism (symmetric with L1)
        if (typeof GlobalConductor !== 'undefined' && GlobalConductor && typeof GlobalConductor.update === 'function') {
          const beatCtxL2 = GlobalConductor.update(measureIndex, beatIndex);
          playProb = beatCtxL2.playProb;
          stutterProb = beatCtxL2.stutterProb;
        }

        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        EventBus.emit('beat-binaural-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex, layer: 'L2' });
        setBalanceAndFX();
        // Apply Stutter default directive for this beat (symmetric with L1)
        try { if (typeof Stutter !== 'undefined' && Stutter && typeof Stutter.prepareBeat === 'function') Stutter.prepareBeat(beatStart); } catch { /* ignore */ }
        // Capture FX intensity with full payload (symmetric with L1)
        const fxStereoPanL2 = typeof balOffset === 'number' ? m.abs(balOffset) / 45 : 0;
        const fxVelocityShiftL2 = (typeof refVar === 'number' && typeof bassVar === 'number')
          ? m.abs(refVar + bassVar) / 20 : 0;
        EventBus.emit('beat-fx-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex, layer: 'L2', stereoPan: fxStereoPanL2, velocityShift: fxVelocityShiftL2 });
        playDrums2();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        // Run any explicit Stutter plans scheduled for this beat
        try { if (typeof Stutter !== 'undefined' && Stutter && typeof Stutter.runDuePlans === 'function') Stutter.runDuePlans(beatStart); } catch { /* ignore */ }
        playNotes('beat', { playProb, stutterProb });

        microUnitAttenuator.begin('div', divsPerBeat);
        for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {

          setUnitTiming('div');
          if (divIndex > 0) { playNotes('div', { playProb, stutterProb }); }

          microUnitAttenuator.begin('subdiv', subdivsPerDiv);
          for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            if (subdivIndex > 0) { playNotes('subdiv', { playProb, stutterProb }); }

            microUnitAttenuator.begin('subsubdiv', subsubsPerSub);
            for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotes('subsubdiv', { playProb, stutterProb }); }
            }
            microUnitAttenuator.flush();
          }
          microUnitAttenuator.flush();
        }
        microUnitAttenuator.flush();
      }
    }

    // Clean layer state at phrase boundary to prevent state bleeding
    playMotifs.resetLayerState(L2);
    LM.advance('L2', 'phrase');
  }

  LM.advance('L1', 'section');

  LM.advance('L2', 'section');

}

  grandFinale();
}

// Run main only when invoked as the entry script
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write('main.js failed: ' + (err && err.stack ? err.stack : err) + '\n');
    process.exit(1);
  });
}
