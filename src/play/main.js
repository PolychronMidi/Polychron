// main.js - Main composition engine orchestrating section, phrase, measure hierarchy.
require('../index');

main = async function main() { console.log('Starting main.js ...');

const boot = mainBootstrap.parseControls();
mainBootstrap.assertBootstrapGlobals();
const EVENTS = eventCatalog.names;

const { layer: L1 } = LM.register('L1', 'c1', {}, () => setTuningAndInstruments());
const { layer: L2 } = LM.register('L2', 'c2', {}, () => setTuningAndInstruments());
LM.register('L0', [], {});

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
    if (!Array.isArray(availableFamilies)) {
      throw new Error('main.selectPhraseFamily: availableFamilies must be an array');
    }
    if (availableFamilies.length === 0) return null;
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

const preferLongForm = SECTIONS.max > SECTIONS.min && SECTIONS.max >= 5 && rf() < 0.72;
totalSections = preferLongForm ? SECTIONS.max : ri(SECTIONS.min, SECTIONS.max);
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

// Activate metaprofile (if configured). Set once per run, hot-switchable from lab postBoot().
// null = no metaprofile. ACTIVE_META_PROFILE is a boot-validated global so no typeof guard needed.
// The setActive() call persists to metrics/metaprofile-active.json -- authoritative record.
if (ACTIVE_META_PROFILE) {
  metaProfiles.setActive(ACTIVE_META_PROFILE);
}

for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  timeStream.setPosition('section', sectionIndex);
  let sectionL1BeatCount = 0;
  // Snapshot conductor state before section reset for cross-section narrative memory
  if (sectionIndex > 0) sectionMemory.snapshot();
  crossLayerLifecycleManager.resetSection();
  stutterVariants.resetSection();
  // Select section type from SECTION_TYPES based on position.
  // Substrate-level override: when the active metaprofile declares
  // sectionArc and its length matches totalSections, the metaprofile
  // owns the structural sequence -- this section's type is read from
  // sectionArc[sectionIndex]. Otherwise fall through to default logic
  // (intro / coda anchored at the ends, weighted-random in between).
  let activeSectionType = null;
  const _arcOverride = metaProfiles.getSectionArcOverride();
  if (_arcOverride && _arcOverride.length === totalSections && Array.isArray(SECTION_TYPES) && SECTION_TYPES.length > 0) {
    const _arcType = _arcOverride[sectionIndex];
    activeSectionType = SECTION_TYPES.find((t) => t.type === _arcType) || null;
  }
  if (!activeSectionType && Array.isArray(SECTION_TYPES) && SECTION_TYPES.length > 0) {
    if (sectionIndex === 0) activeSectionType = SECTION_TYPES.find(t => t.type === 'intro') || SECTION_TYPES[0];
    else if (sectionIndex === totalSections - 1) activeSectionType = SECTION_TYPES.find(t => t.type === 'coda') || SECTION_TYPES[SECTION_TYPES.length - 1];
    else if (sectionIndex >= totalSections - 2) activeSectionType = SECTION_TYPES.find(t => t.type === 'conclusion') || null;
    else activeSectionType = SECTION_TYPES[rw(0, SECTION_TYPES.length - 1, SECTION_TYPES.map(t => t.weight))];
  }
  const sectionPhraseRange = activeSectionType && activeSectionType.phrases ? activeSectionType.phrases : PHRASES_PER_SECTION;
  currentSectionType = activeSectionType ? activeSectionType.type : null;
  currentSectionDynamics = activeSectionType ? activeSectionType.dynamics : null;
  sectionBpmScale = activeSectionType && Number.isFinite(activeSectionType.bpmScale) ? activeSectionType.bpmScale : 1.0;

  // R38 E3: per-section metaprofile rotation for cross-section spectral variety.
  // perceptual_complexity_avg (EnCodec codebook-token entropy) regressed 3 rounds
  // because sections were spectrally uniform (R38 cb0 span only 0.43 across 7
  // sections). Rotating metaprofiles per section produces different regime
  // targets / coupling density / tension envelope / energy envelope -> different
  // composition character -> more differentiated EnCodec tokens per section.
  // Respects ACTIVE_META_PROFILE pin: rotation only fires when user has NOT
  // pinned a single profile. Candidate set is data-driven from each profile's
  // sectionAffinity. Dwell guard skips switches before minDwellSections elapses.
  if (!ACTIVE_META_PROFILE) {
    const sectionTypeKey = currentSectionType || 'exposition';
    const prevProfile = metaProfiles.getActiveName();

    // Step 1: reactive triggers. Build a snapshot from systemDynamicsProfiler
    // and let any profile whose `triggers.enter` condition matches
    // pre-empt the affinity-based pick (subject to dwell). Profile with the
    // highest priority wins. Snapshot fields match real top-level
    // properties on getSnapshot() so trigger declarations like
    // `couplingStrength > 0.7` resolve directly.
    const sysDyn = systemDynamicsProfiler.getSnapshot();
    const trigSnapshot = {
      couplingStrength: sysDyn ? sysDyn.couplingStrength : 0,
      effectiveDimensionality: sysDyn ? sysDyn.effectiveDimensionality : 0,
      velocity: sysDyn ? sysDyn.velocity : 0,
      curvature: sysDyn ? sysDyn.curvature : 0,
      entropyAmplification: sysDyn ? sysDyn.entropyAmplification : 0,
    };
    const triggered = metaProfiles.evaluateTriggers(trigSnapshot);
    let chosen = null;
    if (triggered && triggered.profile !== prevProfile && metaProfiles.canSwitch(sectionIndex, triggered.profile)) {
      chosen = triggered.profile;
    }

    // Step 2: section-affinity pool with nearest-neighbor preference.
    // Falls back when no trigger fired. When a previous profile exists,
    // prefer candidates that are similar in axis-vector space -- smoother
    // sonic transitions than random pivots between distant profiles.
    if (!chosen) {
      let candidates = metaProfiles.bySection(sectionTypeKey);
      if (candidates.length === 0) candidates = ['tense', 'chaotic'];
      const filtered = candidates.filter((p) => p !== prevProfile && metaProfiles.canSwitch(sectionIndex, p));
      let pool = filtered.length > 0 ? filtered : candidates;
      if (prevProfile && pool.length > 1) {
        // Sort pool by distance to prev; pick from nearest 3 to keep
        // some randomness while biasing toward neighbor.
        const ranked = metaProfileDefinitions.nearest(prevProfile, metaProfileDefinitions.list().length);
        const distMap = new Map();
        for (const r of ranked) distMap.set(r.name, r.distance);
        pool = pool
          .slice()
          .sort((a, b) => (distMap.get(a) || 99) - (distMap.get(b) || 99))
          .slice(0, m.min(3, pool.length));
      }
      chosen = pool[ri(0, pool.length - 1)];
    }
    metaProfiles.setActive(chosen, sectionIndex);
  }

  // Activation progress for time-varying envelope axes: how far the
  // currently-active profile has held relative to its minDwellSections.
  // 0.0 = just activated, 1.0 = at-or-past dwell minimum. Controllers
  // calling progressedScaleFactor read this to resolve envelopes.
  // Computed AFTER setActive (above) so progress reflects this section's
  // newly-chosen profile, not the previous one.
  {
    const activeProfileObj = metaProfiles.getActive();
    const since = metaProfiles.getActiveSinceSection();
    if (activeProfileObj && since !== null) {
      const dwell = activeProfileObj.minDwellSections || 1;
      const elapsed = sectionIndex - since;
      metaProfiles.setActivationProgress(elapsed / m.max(1, dwell));
    } else {
      metaProfiles.setActivationProgress(0.5);
    }
  }

  phrasesPerSection = ri(sectionPhraseRange.min, sectionPhraseRange.max);
  mainBootstrap.requireFiniteNumber('phrasesPerSection', phrasesPerSection);
  if (phrasesPerSection <= 0) {
    throw new Error('main: phrasesPerSection must be > 0');
  }
  if (totalSections <= 4 && phrasesPerSection < 2) {
    phrasesPerSection = 2;
  }

  // Let sectionLengthAdvisor adjust phrase count based on energy trajectory
  phrasesPerSection = sectionLengthAdvisor.advisePhraseCount(phrasesPerSection);
  if (totalSections >= 5 && sectionIndex === 0 && phrasesPerSection < 2) {
    phrasesPerSection = 2;
  }
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
    setMeter(); setBpm();
    phraseLengthMomentumTracker.recordPhraseLength(sectionIndex, phraseIndex, measuresPerPhrase1);
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
        activeMetaProfile: metaProfiles.getActiveName(),
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
    const roleSwapResult = dynamicRoleSwap.evaluateSwap(beatStartTime, phraseTension);
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
      }, beatStartTime);
    }

    LM.activate('L2', true);

    // Apply L2 harmonic complement (complementary key/mode relationship to L1)
    harmonicJourney.applyL2ToContext(sectionIndex);

    setMeter(); setBpm();
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
    interactionHeatMap.flushDeferredOrphans(mainBootstrap.requireFiniteNumber('beatStartTime', beatStartTime));
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
      activeMetaProfile: metaProfiles.getActiveName(),
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

  // Empirical-tuning attribution: log which metaprofile owned this section
  // and the section's composite intensity as a coarse outcome score. JSONL
  // append, no-op when no profile is active. Aggregator (separate script)
  // computes per-profile mean scores + sensitivity in a later round.
  if (metaProfiles.getActiveName()) {
    metaProfiles.recordAttribution({
      section: sectionIndex,
      sectionType: currentSectionType,
      score: sEnergy,
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
