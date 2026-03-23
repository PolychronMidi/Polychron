// main.js - Main composition engine orchestrating section, phrase, measure hierarchy.
require('../index');

main = async function main() { console.log('Starting main.js ...');

const boot = mainBootstrap.parseControls();
mainBootstrap.assertBootstrapGlobals();
const EVENTS = eventCatalog.names;

const { layer: L1 } = LM.register('L1', 'c1', {}, () => setTuningAndInstruments());
const { layer: L2 } = LM.register('L2', 'c2', {}, () => setTuningAndInstruments());

// Create composer context for explicit dependency passing (fail-fast: throw if managers missing)
const composerCtx = {
  phraseArc: FactoryManager.getPhraseArcManager(),
  layerMgr: LM,
  rhythmMgr: rhythmRegistry,
  stutterMgr: StutterManager,
  eventBus: eventBus,
  harmonicCtx: harmonicContext,
  motifChain: motifChain,

  /**
   * Context-aware family selection hook: biases family weights by structural phase.
   * Called from factoryFamilies.resolvePhraseFamilyOrFail when no explicit family is requested.
   * @param {{availableFamilies: string[], sectionIndex: number|null, phraseIndex: number|null}} info
   * @returns {string|null} family name or null for default weighted random
   */
  selectPhraseFamily({ availableFamilies }) {
    if (!Array.isArray(availableFamilies) || availableFamilies.length === 0) return null;
    const phase = mainBootstrap.requireNonEmptyString('conductorState.sectionPhase', conductorState.getField('sectionPhase'));

    // Phase-based family affinity - centrally tunable via MAIN_LOOP_CONTROLS.phraseFamilyBias.phaseAffinity
    const preferred = boot.phaseAffinity[phase];
    // Only bias if the preferred family exists; otherwise fall through to weighted random
    if (preferred && availableFamilies.includes(preferred)) {
      if (rf() < boot.phaseBiasLockProbability) return preferred;
    }
    return null;
  }
};
FactoryManager.setComposerContext(composerCtx);

moduleLifecycle.initializeAll();
crossLayerLifecycleManager.resetAll();
traceDrain.init();

// After initialization, validate that registries are sensibly populated.
mainBootstrap.assertRegistryPopulation();

totalSections = ri(SECTIONS.min, SECTIONS.max);
mainBootstrap.requireFiniteNumber('totalSections', totalSections);
if (totalSections <= 0) {
  throw new Error('main: totalSections must be > 0');
}

// Plan the harmonic journey across all sections
harmonicJourney.planJourney(totalSections, { startKey: 'random', startMode: 'random' });
timeStream.setBounds('section', totalSections);

// R71 E5: Trust velocity tracking across diagnostic snapshots.
// Compares trust scores between consecutive snapshots to detect
// rapid trust swings (e.g. stutterContagion -0.403 in one interval).
let mainPreviousSnapshotTrust = null;
function mainComputeTrustVelocity(trustSnapshot) {
  const velocity = /** @type {Record<string, number>} */ ({});
  if (mainPreviousSnapshotTrust) {
    const keys = Object.keys(trustSnapshot);
    for (let i = 0; i < keys.length; i++) {
      const sys = keys[i];
      const cur = trustSnapshot[sys] && typeof trustSnapshot[sys].score === 'number' ? trustSnapshot[sys].score : 0;
      const prev = mainPreviousSnapshotTrust[sys] && typeof mainPreviousSnapshotTrust[sys].score === 'number' ? mainPreviousSnapshotTrust[sys].score : 0;
      velocity[sys] = Number((cur - prev).toFixed(4));
    }
  }
  mainPreviousSnapshotTrust = trustSnapshot;
  return velocity;
}

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  timeStream.setPosition('section', sectionIndex);
  let sectionL1BeatCount = 0;
  // Snapshot conductor state before section reset for cross-section narrative memory
  if (sectionIndex > 0) sectionMemory.snapshot();
  crossLayerLifecycleManager.resetSection();
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);
  mainBootstrap.requireFiniteNumber('phrasesPerSection', phrasesPerSection);
  if (phrasesPerSection <= 0) {
    throw new Error('main: phrasesPerSection must be > 0');
  }

  // Let sectionLengthAdvisor adjust phrase count based on energy trajectory
  phrasesPerSection = sectionLengthAdvisor.advisePhraseCount(phrasesPerSection);
  mainBootstrap.requireFiniteNumber('sectionLengthAdvisor.advisePhraseCount result', phrasesPerSection);
  if (phrasesPerSection <= 0) {
    throw new Error('main: sectionLengthAdvisor.advisePhraseCount must return a value > 0');
  }
  timeStream.setBounds('phrase', phrasesPerSection);

  // Emit section boundary event to reset FX feedback accumulator
  eventBus.emit(EVENTS.SECTION_BOUNDARY, { sectionIndex });

  // Apply harmonic journey stop for this section (sets harmonicContext for L1)
  harmonicJourney.applyToContext(sectionIndex);

  // Seed new section with attenuated state from previous section
  if (sectionIndex > 0) sectionMemory.seed();

  // Phase-driven conductor profile: match the conductor's character to the structural moment
  conductorConfig.applyPhaseProfile();

  // Prepare pivot chord bridge for section transitions with key changes
  pivotChordBridge.prepareBridge(sectionIndex);

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
    timeStream.setPosition('phrase', phraseIndex);
    eventBus.emit(EVENTS.PHRASE_BOUNDARY, { phraseIndex, sectionIndex, phrasesPerSection });
    crossLayerLifecycleManager.resetPhrase();
    // Restore L1 harmonic context (may have been overwritten by L2's complement)
    harmonicJourney.applyToContext(sectionIndex);

    const phraseFamily = FactoryManager.resolvePhraseFamilyOrFail({ root: 'random' }, composerCtx);
    LM.setPhraseFamily(phraseFamily);

    const phraseL1Composer = layerPass.selectLayerComposerForMeasure('L1', phraseFamily, composerCtx);
    layerPass.selectLayerComposerForMeasure('L2', phraseFamily, composerCtx);
    composer = phraseL1Composer;
    getMeterPair.pick();
    // Activate L1 layer first so activation doesn't overwrite freshly computed timing
    LM.activate('L1', false);
    getMidiTiming();
    // Initialize polyrhythmic phase coupling after alignment is computed
    phaseLockedRhythmGenerator.initializePolyrhythmCoupling('L1', 'L2', measuresPerPhrase1, measuresPerPhrase2);
    measuresPerPhrase = measuresPerPhrase1;
    setUnitTiming('phrase');
    sectionL1BeatCount += layerPass.runLayerPass('L1', phraseFamily, { withConductorTick: true }, { boot, composerCtx });

    // R69 E5: Periodic beat-interval diagnostic snapshots. Section-boundary
    // snapshots give 3-7 data points per run. Periodic snapshots every 20 L1
    // beats add intra-section resolution for diagnosing mid-section dynamics
    // (e.g. phase collapse, trust balloon) that section snapshots miss.
    // R70 E3: Periodic snapshots promoted to full telemetry format
    // (parity with section-boundary snapshots). R69 periodic snapshots
    // had sparse format, missing trust/coupling detail needed to diagnose
    // mid-section flicker-phase spikes and trust shifts.
    if (traceDrain.isEnabled() && sectionL1BeatCount > 0 && sectionL1BeatCount % 20 === 0) {
      const mainPSnap = systemDynamicsProfiler.getSnapshot();
      const mainPHome = couplingHomeostasis.getState();
      const mainPCouplingMeans = /** @type {Record<string, number>} */ ({});
      if (mainPSnap && mainPSnap.couplingMatrix) {
        for (const pair in mainPSnap.couplingMatrix) {
          const val = mainPSnap.couplingMatrix[pair];
          if (Number.isFinite(val)) mainPCouplingMeans[pair] = m.abs(val);
        }
      }
      const mainPTrust = adaptiveTrustScores.getSnapshot();
      const mainPTrustVel = mainComputeTrustVelocity(mainPTrust);
      traceDrain.recordSnapshot({
        beatKey: sectionIndex + ':periodic:' + sectionL1BeatCount,
        timeMs: beatStartTime * 1000,
        trigger: 'periodic',
        effectiveDim: mainPSnap ? mainPSnap.effectiveDimensionality : 0,
        trustScores: mainPTrust,
        trustVelocity: mainPTrustVel,
        activeProfile: conductorConfig.getActiveProfileName(),
        couplingMeans: mainPCouplingMeans,
        globalGainMultiplier: mainPHome ? mainPHome.globalGainMultiplier : 0,
        regime: mainPSnap ? mainPSnap.regime : 'unknown',
        couplingStrength: mainPSnap ? mainPSnap.couplingStrength : 0,
        phaseIntegrity: mainPSnap ? (mainPSnap.phaseCouplingCoverage > 0.2 ? 'healthy' : 'warning') : 'unknown',
        axisEnergyShare: pipelineCouplingManager.getAxisEnergyShare()
      });
    }

    // Clean layer state at phrase boundary to prevent state bleeding
    playMotifs.resetLayerState(L1);
    LM.advance('L1', 'phrase');

    // #7 Dynamic Role Swap: evaluate at phrase boundary (tension valley = natural swap point)
    const phraseTension = mainBootstrap.requireUnitInterval('conductorState.compositeIntensity', conductorState.getField('compositeIntensity'));
    const roleSwapResult = dynamicRoleSwap.evaluateSwap(beatStartTime * 1000, phraseTension);
    const rsp = MAIN_LOOP_CONTROLS.trustPayoffs.roleSwap;
    if (roleSwapResult.swapped) {
      adaptiveTrustScores.registerOutcome(trustSystems.names.ROLE_SWAP, rsp.swapped);
    }
    if (roleSwapResult.swapped) {
      explainabilityBus.emit('role-swap', 'both', {
        swapCount: roleSwapResult.swapCount,
        phraseIndex,
        sectionIndex,
        phraseTension
      }, beatStartTime * 1000);
    }

    LM.activate('L2', true);

    // Apply L2 harmonic complement (complementary key/mode relationship to L1)
    harmonicJourney.applyL2ToContext(sectionIndex);

    getMidiTiming();
    measuresPerPhrase = measuresPerPhrase2;
    setUnitTiming('phrase');
    layerPass.runLayerPass('L2', phraseFamily, {}, { boot, composerCtx });

    // Flush trace after L2 pass to guarantee L2 entries are persisted.
    // Without this, L2 entries remain in mainBuffer and can be lost if a later
    // step throws before traceDrain.shutdown(). Also forces the trace file
    // to contain L2 entries interleaved with L1 for diagnostic visibility.
    traceDrain.flush();

    // Clean layer state at phrase boundary to prevent state bleeding
    playMotifs.resetLayerState(L2);
    LM.advance('L2', 'phrase');
    interactionHeatMap.flushDeferredOrphans(mainBootstrap.requireFiniteNumber('beatStartTime', beatStartTime) * 1000);
  }

  if (sectionL1BeatCount <= 0) {
    throw new Error('main: section ' + sectionIndex + ' produced no L1 beats');
  }

  // Record section in structuralFormTracker for form-level awareness
  const sKey = mainBootstrap.requireNonEmptyString('conductorState.key', conductorState.getField('key'));
  const sMode = mainBootstrap.requireNonEmptyString('conductorState.mode', conductorState.getField('mode'));
  const sFamily = mainBootstrap.requireNonEmptyString('FactoryManager.getActiveFamily()', FactoryManager.getActiveFamily());
  const sEnergy = mainBootstrap.requireUnitInterval('conductorState.compositeIntensity', conductorState.getField('compositeIntensity'));
  structuralFormTracker.recordSection(sectionIndex, sFamily, sKey, sMode, sEnergy);

  // Mid-run diagnostic snapshot at section boundary. Captures system
  // state evolution that beat-level traces miss (effectiveDim recovery, trust
  // convergence, gain multiplier trajectory). One snapshot per section gives
  // 3-7 data points for the system's evolutionary arc.
  if (traceDrain.isEnabled()) {
    const mainDynSnap = systemDynamicsProfiler.getSnapshot();
    const mainHomeSnap = couplingHomeostasis.getState();
    const mainCouplingMeans = /** @type {Record<string, number>} */ ({});
    if (mainDynSnap && mainDynSnap.couplingMatrix) {
      for (const pair in mainDynSnap.couplingMatrix) {
        const val = mainDynSnap.couplingMatrix[pair];
        if (Number.isFinite(val)) mainCouplingMeans[pair] = m.abs(val);
      }
    }
    const mainSecTrust = adaptiveTrustScores.getSnapshot();
    const mainSecTrustVel = mainComputeTrustVelocity(mainSecTrust);
    traceDrain.recordSnapshot({
      beatKey: sectionIndex + ':end',
      timeMs: beatStartTime * 1000,
      trigger: 'section-boundary',
      effectiveDim: mainDynSnap ? mainDynSnap.effectiveDimensionality : 0,
      trustScores: mainSecTrust,
      trustVelocity: mainSecTrustVel,
      activeProfile: conductorConfig.getActiveProfileName(),
      couplingMeans: mainCouplingMeans,
      globalGainMultiplier: mainHomeSnap ? mainHomeSnap.globalGainMultiplier : 0,
      regime: mainDynSnap ? mainDynSnap.regime : 'unknown',
      couplingStrength: mainDynSnap ? mainDynSnap.couplingStrength : 0,
      phaseIntegrity: mainDynSnap ? (mainDynSnap.phaseCouplingCoverage > 0.2 ? 'healthy' : 'warning') : 'unknown',
      axisEnergyShare: pipelineCouplingManager.getAxisEnergyShare(),
      // R12 E1: section harmonic context for phase-composition correlation
      sectionKey: sKey,
      sectionMode: sMode
    });
  }

  LM.advance('L1', 'section');

  LM.advance('L2', 'section');

}

  grandFinale();

  // Emit system manifest and capability matrix for compositional forensics
  systemManifest.emit();

  traceDrain.shutdown();
}

// Run main only when invoked as the entry script
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write('main.js failed: ' + (err && err.stack ? err.stack : err) + '\n');
    process.exit(1);
  });
}
