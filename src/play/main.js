// main.js - Main composition engine orchestrating section, phrase, measure hierarchy.
require('../index');

main = async function main() { console.log('Starting main.js ...');

const mainLoopControls = (typeof MAIN_LOOP_CONTROLS !== 'undefined' && MAIN_LOOP_CONTROLS && typeof MAIN_LOOP_CONTROLS === 'object')
  ? MAIN_LOOP_CONTROLS
  : {
      phraseFamilyBias: {
        phaseAffinity: {
          intro: 'diatonicCore',
          opening: 'diatonicCore',
          development: 'development',
          climax: 'rhythmicDrive',
          resolution: 'harmonicMotion',
          conclusion: 'tonalExploration'
        },
        lockProbability: 0.5
      },
      stutterPanJitterChance: 0.05,
      fxIntensityNormalization: {
        stereoPanDenominator: 45,
        velocityShiftDenominator: 20
      },
      conductorFallback: {
        playProb: 0.5,
        stutterProb: 0.3
      }
    };

const phaseFamilyBias = (mainLoopControls.phraseFamilyBias && typeof mainLoopControls.phraseFamilyBias === 'object')
  ? mainLoopControls.phraseFamilyBias
  : { phaseAffinity: {}, lockProbability: 0.5 };
const phaseAffinity = (phaseFamilyBias.phaseAffinity && typeof phaseFamilyBias.phaseAffinity === 'object')
  ? phaseFamilyBias.phaseAffinity
  : {};
const phaseBiasLockProbability = Number.isFinite(Number(phaseFamilyBias.lockProbability))
  ? clamp(Number(phaseFamilyBias.lockProbability), 0, 1)
  : 0.5;
const fxIntensityNormalization = (mainLoopControls.fxIntensityNormalization && typeof mainLoopControls.fxIntensityNormalization === 'object')
  ? mainLoopControls.fxIntensityNormalization
  : { stereoPanDenominator: 45, velocityShiftDenominator: 20 };
const fxStereoPanDenominator = Number.isFinite(Number(fxIntensityNormalization.stereoPanDenominator))
  ? m.max(1, Number(fxIntensityNormalization.stereoPanDenominator))
  : 45;
const fxVelocityShiftDenominator = Number.isFinite(Number(fxIntensityNormalization.velocityShiftDenominator))
  ? m.max(1, Number(fxIntensityNormalization.velocityShiftDenominator))
  : 20;
const stutterPanJitterChance = Number.isFinite(Number(mainLoopControls.stutterPanJitterChance))
  ? clamp(Number(mainLoopControls.stutterPanJitterChance), 0, 1)
  : 0.05;
const conductorFallback = (mainLoopControls.conductorFallback && typeof mainLoopControls.conductorFallback === 'object')
  ? mainLoopControls.conductorFallback
  : { playProb: 0.5, stutterProb: 0.3 };
const fallbackPlayProb = Number.isFinite(Number(conductorFallback.playProb))
  ? clamp(Number(conductorFallback.playProb), 0, 1)
  : 0.5;
const fallbackStutterProb = Number.isFinite(Number(conductorFallback.stutterProb))
  ? clamp(Number(conductorFallback.stutterProb), 0, 1)
  : 0.3;

function assertMainBootstrapGlobals() {
  if (typeof EventCatalog === 'undefined' || !EventCatalog || !EventCatalog.names) {
    throw new Error('main.bootstrap: EventCatalog.names is not available');
  }

  const requiredEvents = [
    'SECTION_BOUNDARY',
    'JOURNEY_MOVE',
    'TEXTURE_CONTRAST',
    'BEAT_FX_APPLIED',
    'STUTTER_APPLIED',
    'CONDUCTOR_REGULATION',
    'BEAT_BINAURAL_APPLIED',
    'HARMONIC_CHANGE',
    'NOTES_EMITTED',
    'MOTIF_CHAIN_APPLIED'
  ];
  requiredEvents.forEach((name) => {
    const eventName = EventCatalog.names[name];
    if (typeof eventName !== 'string' || eventName.length === 0) {
      throw new Error(`main.bootstrap: EventCatalog.names.${name} is invalid`);
    }
  });

  const requiredModules = [
    ['EventBus', (typeof EventBus !== 'undefined') ? EventBus : null, 'emit'],
    ['LayerManager', (typeof LM !== 'undefined') ? LM : null, 'register'],
    ['ComposerFactory', (typeof ComposerFactory !== 'undefined') ? ComposerFactory : null, 'getPhraseArcManager'],
    ['ConductorConfig', (typeof ConductorConfig !== 'undefined') ? ConductorConfig : null, 'applyPhaseProfile'],
    ['Stutter', (typeof Stutter !== 'undefined') ? Stutter : null, 'prepareBeat'],
    ['ConductorState', (typeof ConductorState !== 'undefined') ? ConductorState : null, 'initialize'],
    ['ConductorState', (typeof ConductorState !== 'undefined') ? ConductorState : null, 'getField']
  ];
  requiredModules.forEach(([name, obj, method]) => {
    if (!obj || typeof obj[method] !== 'function') {
      throw new Error(`main.bootstrap: ${name}.${method} is not available`);
    }
  });

  const requiredInitializers = [
    ['FXFeedbackListener', (typeof FXFeedbackListener !== 'undefined') ? FXFeedbackListener : null],
    ['StutterFeedbackListener', (typeof StutterFeedbackListener !== 'undefined') ? StutterFeedbackListener : null],
    ['JourneyRhythmCoupler', (typeof JourneyRhythmCoupler !== 'undefined') ? JourneyRhythmCoupler : null],
    ['ConductorRegulationListener', (typeof ConductorRegulationListener !== 'undefined') ? ConductorRegulationListener : null],
    ['DrumTextureCoupler', (typeof DrumTextureCoupler !== 'undefined') ? DrumTextureCoupler : null],
    ['EmissionFeedbackListener', (typeof EmissionFeedbackListener !== 'undefined') ? EmissionFeedbackListener : null],
    ['HarmonicRhythmTracker', (typeof HarmonicRhythmTracker !== 'undefined') ? HarmonicRhythmTracker : null],
    ['ConductorState', (typeof ConductorState !== 'undefined') ? ConductorState : null],
    ['CadenceAdvisor', (typeof CadenceAdvisor !== 'undefined') ? CadenceAdvisor : null]
  ];
  requiredInitializers.forEach(([name, obj]) => {
    if (!obj || typeof obj.initialize !== 'function') {
      throw new Error(`main.bootstrap: ${name}.initialize is not available`);
    }
  });
}

assertMainBootstrapGlobals();
const EVENTS = EventCatalog.names;

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
    const phase = (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getField === 'function')
      ? (ConductorState.getField('sectionPhase') || 'development')
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? (HarmonicContext.getField('sectionPhase') || 'development')
        : 'development';

    // Phase-based family affinity — centrally tunable via MAIN_LOOP_CONTROLS.phraseFamilyBias.phaseAffinity
    const preferred = phaseAffinity[phase];
    // Only bias if the preferred family exists; otherwise fall through to weighted random
    if (preferred && availableFamilies.includes(preferred)) {
      if (rf() < phaseBiasLockProbability) return preferred;
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

  // Record composer family for TexturalMemoryAdvisor variety tracking
  if (typeof TexturalMemoryAdvisor !== 'undefined' && TexturalMemoryAdvisor && typeof TexturalMemoryAdvisor.recordUsage === 'function') {
    TexturalMemoryAdvisor.recordUsage(phraseFamily, (typeof sectionIndex === 'number') ? sectionIndex : 0);
  }

  return nextComposer;
};

FXFeedbackListener.initialize();
StutterFeedbackListener.initialize();
JourneyRhythmCoupler.initialize();
ConductorRegulationListener.initialize();
DrumTextureCoupler.initialize();
EmissionFeedbackListener.initialize();
HarmonicRhythmTracker.initialize();
ConductorState.initialize();
CadenceAdvisor.initialize();

totalSections = ri(SECTIONS.min, SECTIONS.max);

// Plan the harmonic journey across all sections
if (typeof HarmonicJourney !== 'undefined' && HarmonicJourney && typeof HarmonicJourney.planJourney === 'function') {
  HarmonicJourney.planJourney(totalSections, { startKey: 'random', startMode: 'random' });
}

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  // Let SectionLengthAdvisor adjust phrase count based on energy trajectory
  if (typeof SectionLengthAdvisor !== 'undefined' && SectionLengthAdvisor && typeof SectionLengthAdvisor.advisePhraseCount === 'function') {
    phrasesPerSection = SectionLengthAdvisor.advisePhraseCount(phrasesPerSection);
  }

  // Emit section boundary event to reset FX feedback accumulator
  EventBus.emit(EVENTS.SECTION_BOUNDARY, { sectionIndex });

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
        : { playProb: fallbackPlayProb, stutterProb: fallbackStutterProb };

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
        EventBus.emit(EVENTS.BEAT_BINAURAL_APPLIED, {
          beatIndex,
          sectionIndex,
          phraseIndex,
          measureIndex,
          layer: 'L1',
          freqOffset: Number.isFinite(Number(binauralFreqOffset)) ? Number(binauralFreqOffset) : 0,
          flipBin: Boolean(flipBin)
        });
        setBalanceAndFX();
        // Apply Stutter default directive for this beat (coherence key, etc.)
        if (typeof Stutter === 'undefined' || !Stutter || typeof Stutter.prepareBeat !== 'function') {
          throw new Error('main: Stutter.prepareBeat is not available');
        }
        Stutter.prepareBeat(beatStart);
        // Capture FX intensity from balance and variation globals (normalized 0-1)
        const fxStereoPan = typeof balOffset === 'number' ? m.abs(balOffset) / fxStereoPanDenominator : 0;
        const fxVelocityShift = (typeof refVar === 'number' && typeof bassVar === 'number')
          ? m.abs(refVar + bassVar) / fxVelocityShiftDenominator : 0;
        EventBus.emit(EVENTS.BEAT_FX_APPLIED, { beatIndex, sectionIndex, phraseIndex, measureIndex, layer: 'L1', stereoPan: fxStereoPan, velocityShift: fxVelocityShift });
        playDrums();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < stutterPanJitterChance ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        // Run any explicit Stutter plans scheduled for this beat
        if (typeof Stutter === 'undefined' || !Stutter || typeof Stutter.runDuePlans !== 'function') {
          throw new Error('main: Stutter.runDuePlans is not available');
        }
        Stutter.runDuePlans(beatStart);
        playNotes('beat', { playProb, stutterProb });

        // Cross-layer interactions (L1)
        const clAbsMs = beatStartTime * 1000;
        StutterContagion.postStutter(clAbsMs, 'L1', clamp(stutterProb, 0, 1), flipBin ? flipBinT3 : flipBinF3, 'fade');
        StutterContagion.apply(clAbsMs, 'L1');
        TemporalGravity.postDensity(clAbsMs, 'L1', TemporalGravity.measureDensity('L1', beatStartTime));
        FeedbackOscillator.applyFeedback(clAbsMs, 'L1');
        const clTension = (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getField === 'function')
          ? clamp(Number(ConductorState.getField('compositeIntensity')) || 0, 0, 1) : 0;
        const clCadence = (typeof CadenceAdvisor !== 'undefined' && CadenceAdvisor && typeof CadenceAdvisor.shouldCadence === 'function')
          ? CadenceAdvisor.shouldCadence() : { suggest: false };
        CadenceAlignment.postTension(clAbsMs, 'L1', clTension, clCadence.suggest);
        CadenceAlignment.applyAlignment(clAbsMs, 'L1', clTension);

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
        : { playProb: fallbackPlayProb, stutterProb: fallbackStutterProb };

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
        EventBus.emit(EVENTS.BEAT_BINAURAL_APPLIED, {
          beatIndex,
          sectionIndex,
          phraseIndex,
          measureIndex,
          layer: 'L2',
          freqOffset: Number.isFinite(Number(binauralFreqOffset)) ? Number(binauralFreqOffset) : 0,
          flipBin: Boolean(flipBin)
        });
        setBalanceAndFX();
        // Apply Stutter default directive for this beat (symmetric with L1)
        if (typeof Stutter === 'undefined' || !Stutter || typeof Stutter.prepareBeat !== 'function') {
          throw new Error('main: Stutter.prepareBeat is not available');
        }
        Stutter.prepareBeat(beatStart);
        // Capture FX intensity with full payload (symmetric with L1)
        const fxStereoPanL2 = typeof balOffset === 'number' ? m.abs(balOffset) / fxStereoPanDenominator : 0;
        const fxVelocityShiftL2 = (typeof refVar === 'number' && typeof bassVar === 'number')
          ? m.abs(refVar + bassVar) / fxVelocityShiftDenominator : 0;
        EventBus.emit(EVENTS.BEAT_FX_APPLIED, { beatIndex, sectionIndex, phraseIndex, measureIndex, layer: 'L2', stereoPan: fxStereoPanL2, velocityShift: fxVelocityShiftL2 });
        playDrums2();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < stutterPanJitterChance ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        // Run any explicit Stutter plans scheduled for this beat
        if (typeof Stutter === 'undefined' || !Stutter || typeof Stutter.runDuePlans !== 'function') {
          throw new Error('main: Stutter.runDuePlans is not available');
        }
        Stutter.runDuePlans(beatStart);
        playNotes('beat', { playProb, stutterProb });

        // Cross-layer interactions (L2)
        const clAbsMsL2 = beatStartTime * 1000;
        StutterContagion.postStutter(clAbsMsL2, 'L2', clamp(stutterProb, 0, 1), flipBin ? flipBinT3 : flipBinF3, 'fade');
        StutterContagion.apply(clAbsMsL2, 'L2');
        TemporalGravity.postDensity(clAbsMsL2, 'L2', TemporalGravity.measureDensity('L2', beatStartTime));
        FeedbackOscillator.applyFeedback(clAbsMsL2, 'L2');
        const clTensionL2 = (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getField === 'function')
          ? clamp(Number(ConductorState.getField('compositeIntensity')) || 0, 0, 1) : 0;
        const clCadenceL2 = (typeof CadenceAdvisor !== 'undefined' && CadenceAdvisor && typeof CadenceAdvisor.shouldCadence === 'function')
          ? CadenceAdvisor.shouldCadence() : { suggest: false };
        CadenceAlignment.postTension(clAbsMsL2, 'L2', clTensionL2, clCadenceL2.suggest);
        CadenceAlignment.applyAlignment(clAbsMsL2, 'L2', clTensionL2);

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

  // Record section in StructuralFormTracker for form-level awareness
  if (typeof StructuralFormTracker !== 'undefined' && StructuralFormTracker && typeof StructuralFormTracker.recordSection === 'function') {
    const sKey = (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getField === 'function')
      ? (ConductorState.getField('key') || 'C')
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? (HarmonicContext.getField('key') || 'C')
        : 'C';
    const sMode = (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getField === 'function')
      ? (ConductorState.getField('mode') || 'ionian')
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? (HarmonicContext.getField('mode') || 'ionian')
        : 'ionian';
    const sFamily = (typeof ComposerFactory !== 'undefined' && ComposerFactory && typeof ComposerFactory.getActiveFamily === 'function')
      ? (ComposerFactory.getActiveFamily() || 'default') : 'default';
    const sEnergy = (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getField === 'function')
      ? (Number(ConductorState.getField('compositeIntensity')) || 0)
      : 0;
    StructuralFormTracker.recordSection(sectionIndex, sFamily, sKey, sMode, sEnergy);
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
