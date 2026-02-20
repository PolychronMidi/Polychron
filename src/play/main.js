// main.js - Main composition engine orchestrating section, phrase, measure hierarchy.
require('../index');

main = async function main() { console.log('Starting main.js ...');

const boot = MainBootstrap.parseControls();
MainBootstrap.assertBootstrapGlobals();
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
    const phase = MainBootstrap.requireNonEmptyString('ConductorState.sectionPhase', ConductorState.getField('sectionPhase'));

    // Phase-based family affinity — centrally tunable via MAIN_LOOP_CONTROLS.phraseFamilyBias.phaseAffinity
    const preferred = boot.phaseAffinity[phase];
    // Only bias if the preferred family exists; otherwise fall through to weighted random
    if (preferred && availableFamilies.includes(preferred)) {
      if (rf() < boot.phaseBiasLockProbability) return preferred;
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
  TexturalMemoryAdvisor.recordUsage(phraseFamily, MainBootstrap.requireFiniteNumber('sectionIndex', sectionIndex));

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
CrossLayerLifecycleManager.resetAll();

totalSections = ri(SECTIONS.min, SECTIONS.max);
MainBootstrap.requireFiniteNumber('totalSections', totalSections);
if (totalSections <= 0) {
  throw new Error('main: totalSections must be > 0');
}

// Plan the harmonic journey across all sections
HarmonicJourney.planJourney(totalSections, { startKey: 'random', startMode: 'random' });

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  CrossLayerLifecycleManager.resetSection();
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);
  MainBootstrap.requireFiniteNumber('phrasesPerSection', phrasesPerSection);
  if (phrasesPerSection <= 0) {
    throw new Error('main: phrasesPerSection must be > 0');
  }

  // Let SectionLengthAdvisor adjust phrase count based on energy trajectory
  phrasesPerSection = SectionLengthAdvisor.advisePhraseCount(phrasesPerSection);
  MainBootstrap.requireFiniteNumber('SectionLengthAdvisor.advisePhraseCount result', phrasesPerSection);
  if (phrasesPerSection <= 0) {
    throw new Error('main: SectionLengthAdvisor.advisePhraseCount must return a value > 0');
  }

  // Emit section boundary event to reset FX feedback accumulator
  EventBus.emit(EVENTS.SECTION_BOUNDARY, { sectionIndex });

  // Apply harmonic journey stop for this section (sets HarmonicContext for L1)
  HarmonicJourney.applyToContext(sectionIndex);

  // Phase-driven conductor profile: match the conductor's character to the structural moment
  ConductorConfig.applyPhaseProfile();

  // Prepare pivot chord bridge for section transitions with key changes
  PivotChordBridge.prepareBridge(sectionIndex);

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
    CrossLayerLifecycleManager.resetPhrase();
    // Restore L1 harmonic context (may have been overwritten by L2's complement)
    HarmonicJourney.applyToContext(sectionIndex);

    const phraseFamily = ComposerFactory.resolvePhraseFamilyOrFail({ root: 'random' }, composerCtx);
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
    PhaseLockedRhythmGenerator.initializePolyrhythmCoupling('L1', 'L2', measuresPerPhrase1, measuresPerPhrase2);
    measuresPerPhrase = measuresPerPhrase1;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      selectLayerComposerForMeasure('L1', phraseFamily);
      setUnitTiming('measure');

      // Advance conductor crossfade and self-regulation once per measure
      ConductorConfig.tickCrossfade();
      ConductorConfig.regulationTick();

      MainBootstrap.getConductorProbabilities(measureIndex, -1);
      let playProb, stutterProb;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        const beatCtx = MainBootstrap.getConductorProbabilities(measureIndex, beatIndex);
        playProb = beatCtx.playProb;
        stutterProb = beatCtx.stutterProb;

        const beatResult = processBeat('L1', playProb, stutterProb, boot);
        playProb = beatResult.playProb;
        stutterProb = beatResult.stutterProb;

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

    // #7 Dynamic Role Swap: evaluate at phrase boundary (tension valley = natural swap point)
    const phraseTension = MainBootstrap.requireUnitInterval('ConductorState.compositeIntensity', ConductorState.getField('compositeIntensity'));
    const roleSwapResult = DynamicRoleSwap.evaluateSwap(beatStartTime * 1000, phraseTension);
    AdaptiveTrustScores.registerOutcome('roleSwap', roleSwapResult.swapped ? 0.35 : -0.02);
    if (roleSwapResult.swapped) {
      ExplainabilityBus.emit('role-swap', 'both', {
        swapCount: roleSwapResult.swapCount,
        phraseIndex,
        sectionIndex,
        phraseTension
      }, beatStartTime * 1000);
    }

    LM.activate('L2', true);

    // Apply L2 harmonic complement (complementary key/mode relationship to L1)
    HarmonicJourney.applyL2ToContext(sectionIndex);

    getMidiTiming();
    measuresPerPhrase = measuresPerPhrase2;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      selectLayerComposerForMeasure('L2', phraseFamily);
      setUnitTiming('measure');

      MainBootstrap.getConductorProbabilities(measureIndex, -1);
      let playProb, stutterProb;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        const beatCtx = MainBootstrap.getConductorProbabilities(measureIndex, beatIndex);
        playProb = beatCtx.playProb;
        stutterProb = beatCtx.stutterProb;

        const beatResult = processBeat('L2', playProb, stutterProb, boot);
        playProb = beatResult.playProb;
        stutterProb = beatResult.stutterProb;

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
    InteractionHeatMap.flushDeferredOrphans(MainBootstrap.requireFiniteNumber('beatStartTime', beatStartTime) * 1000);
  }

  // Record section in StructuralFormTracker for form-level awareness
  const sKey = MainBootstrap.requireNonEmptyString('ConductorState.key', ConductorState.getField('key'));
  const sMode = MainBootstrap.requireNonEmptyString('ConductorState.mode', ConductorState.getField('mode'));
  const sFamily = MainBootstrap.requireNonEmptyString('ComposerFactory.getActiveFamily()', ComposerFactory.getActiveFamily());
  const sEnergy = MainBootstrap.requireUnitInterval('ConductorState.compositeIntensity', ConductorState.getField('compositeIntensity'));
  StructuralFormTracker.recordSection(sectionIndex, sFamily, sKey, sMode, sEnergy);

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
