moduleLifecycle.declare({
  name: 'conductorState',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['conductorState'],
  init: (deps) => {
  const V = deps.validator.create('conductorState');

  let initialized = false;

  const snapshot = {
    key: 'C',
    mode: 'major',
    quality: 'major',
    scale: /** @type {any[]} */ ([]),
    chords: /** @type {any[]} */ ([]),
    tension: 0,
    harmonicRhythm: 0,
    harmonicMutationCount: 0,
    excursion: 0,
    sectionPhase: 'development',
    phrasePosition: 0,
    phrasePhase: 'opening',
    phraseDynamism: 0.7,
    registerBias: 0,
    densityMultiplier: 1,
    voiceIndependence: 0.5,
    compositeIntensity: 0,
    playProb: 0.5,
    stutterProb: 0.3,
    flicker: 1,
    textureMode: 'single',
    textureFatigue: 0,
    densityBias: 0,
    crossModBias: 1,
    emissionRatio: 1,
    extraDensityCorrection: 1,
    extraCoherenceDensityBias: 1,
    activeProfile: 'default',
    journeyMove: 'origin',
    journeyDistance: 0,
    journeyKey: 'C',
    journeyMode: 'major',
    tick: 0,
    updatedAt: 0
  };

  function writeHarmonicFromContext() {
    const state = harmonicContext.get();
    if (!V.optionalType(state, 'object')) return;

    if (typeof state.key === 'string' && state.key.length > 0) snapshot.key = state.key;
    if (typeof state.mode === 'string' && state.mode.length > 0) snapshot.mode = state.mode;
    if (typeof state.quality === 'string' && state.quality.length > 0) snapshot.quality = state.quality;
    if (Array.isArray(state.scale)) snapshot.scale = state.scale.slice();
    if (Array.isArray(state.chords)) snapshot.chords = state.chords.slice();
    snapshot.tension = clamp(V.optionalFinite(Number(state.tension), snapshot.tension), 0, 1);
    snapshot.harmonicMutationCount = m.max(0, V.optionalFinite(Number(state.mutationCount), snapshot.harmonicMutationCount));
    snapshot.excursion = m.max(0, V.optionalFinite(Number(state.excursion), snapshot.excursion));
    if (typeof state.sectionPhase === 'string' && state.sectionPhase.length > 0) snapshot.sectionPhase = state.sectionPhase;
  }

  function writeRegulationFromConductor() {
    snapshot.densityBias = V.optionalFinite(Number(conductorConfig.getRegulationDensityBias()), snapshot.densityBias);
    snapshot.crossModBias = V.optionalFinite(Number(conductorConfig.getRegulationCrossModBias()), snapshot.crossModBias);

    const activeProfile = conductorConfig.getActiveProfileName();
    if (typeof activeProfile === 'string' && activeProfile.length > 0) snapshot.activeProfile = activeProfile;
    const activeMetaProfile = metaProfiles.getActiveName();
    if (activeMetaProfile) snapshot.activeMetaProfile = activeMetaProfile;
  }

  // Core pipeline fields consumed from data: compositeIntensity, harmonicRhythm,
  // emissionRatio, playProb, stutterProb, phraseCtx. Registry stateProvider
  // fields are bulk-merged into data but only read if explicitly destructured here.
  function updateFromConductor(data = {}) {
    V.assertObject(data, 'data');

    // Cast to any to satisfy TS/CheckJS when reading dynamically-shaped payloads
    const conductorStateData = /** @type {any} */ (data);

    writeHarmonicFromContext();
    writeRegulationFromConductor();

    const phraseCtx = (conductorStateData.phraseCtx && typeof conductorStateData.phraseCtx === 'object')
      ? conductorStateData.phraseCtx
      : FactoryManager.sharedPhraseArcManager.getPhraseContext();

    if (phraseCtx) {
      snapshot.phrasePosition = clamp(V.optionalFinite(Number(phraseCtx.position), snapshot.phrasePosition), 0, 1);
      if (typeof phraseCtx.phase === 'string' && phraseCtx.phase.length > 0) snapshot.phrasePhase = phraseCtx.phase;
      snapshot.phraseDynamism = clamp(V.optionalFinite(Number(phraseCtx.dynamism), snapshot.phraseDynamism), 0, 1);
      snapshot.registerBias = V.optionalFinite(Number(phraseCtx.registerBias), snapshot.registerBias);
      snapshot.densityMultiplier = V.optionalFinite(Number(phraseCtx.densityMultiplier), snapshot.densityMultiplier);
      snapshot.voiceIndependence = clamp(V.optionalFinite(Number(phraseCtx.voiceIndependence), snapshot.voiceIndependence), 0, 1);
    }

    snapshot.compositeIntensity = clamp(V.optionalFinite(Number(conductorStateData.compositeIntensity), snapshot.compositeIntensity), 0, 1);
    snapshot.harmonicRhythm = clamp(V.optionalFinite(Number(conductorStateData.harmonicRhythm), snapshot.harmonicRhythm), 0, 1);
    snapshot.emissionRatio = clamp(V.optionalFinite(Number(conductorStateData.emissionRatio), snapshot.emissionRatio), 0, 2);
    snapshot.extraDensityCorrection = V.optionalFinite(Number(conductorStateData.extraDensityCorrection), snapshot.extraDensityCorrection);
    snapshot.extraCoherenceDensityBias = V.optionalFinite(Number(conductorStateData.extraCoherenceDensityBias), snapshot.extraCoherenceDensityBias);
    snapshot.playProb = clamp(V.optionalFinite(Number(conductorStateData.playProb), snapshot.playProb), 0, 1);
    snapshot.stutterProb = clamp(V.optionalFinite(Number(conductorStateData.stutterProb), snapshot.stutterProb), 0, 1);
    snapshot.flicker = clamp(V.optionalFinite(Number(conductorStateData.flicker), snapshot.flicker), 0.4, 1.6);

    snapshot.textureFatigue = clamp(Number(textureBlender.getRecentDensity()), 0, 1);

    snapshot.tick = V.optionalFinite(Number(beatStartTime), snapshot.tick);
    snapshot.updatedAt = Date.now();
  }

  function resetSection() {
    snapshot.textureMode = 'single';
    snapshot.textureFatigue = 0;
    snapshot.updatedAt = Date.now();
  }

  function initialize() {
    if (initialized) return true;
    const EVENTS = V.getEventsOrThrow();

    conductorIntelligence.registerModule('conductorState', { reset: resetSection }, ['section']);

    eventBus.on(EVENTS.TEXTURE_CONTRAST, (data) => {
      snapshot.textureMode = data.mode;
      snapshot.compositeIntensity = clamp(data.composite, 0, 1);
      snapshot.textureFatigue = clamp(Number(textureBlender.getRecentDensity()), 0, 1);
      snapshot.updatedAt = Date.now();
    });

    eventBus.on(EVENTS.JOURNEY_MOVE, (data) => {
      snapshot.journeyMove = data.move;
      snapshot.journeyDistance = m.max(0, data.distance);
      snapshot.journeyKey = data.key;
      snapshot.journeyMode = data.mode;
      snapshot.updatedAt = Date.now();
    });

    eventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
      snapshot.densityBias = data.densityBias;
      snapshot.crossModBias = data.crossModBias;
      snapshot.activeProfile = data.profile;
      snapshot.updatedAt = Date.now();
    });

    eventBus.on(EVENTS.HARMONIC_CHANGE, (data) => {
      snapshot.key = data.key;
      snapshot.mode = data.mode;
      snapshot.quality = data.quality;
      if (Array.isArray(data.scale)) snapshot.scale = data.scale.slice();
      if (Array.isArray(data.chords)) snapshot.chords = data.chords.slice();
      snapshot.sectionPhase = data.sectionPhase;
      snapshot.excursion = m.max(0, data.excursion);
      snapshot.tension = clamp(data.tension, 0, 1);
      snapshot.harmonicMutationCount = m.max(0, data.mutationCount);
      snapshot.harmonicRhythm = clamp(Number(harmonicRhythmTracker.getHarmonicRhythm()), 0, 1);
      snapshot.updatedAt = Date.now();
    });

    initialized = true;
    return true;
  }

  function getSnapshot() {
    return Object.assign({}, snapshot);
  }

  function getField(field) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, field)) {
      throw new Error(`conductorState.getField: unknown field "${field}"`);
    }
    return snapshot[field];
  }

  function get(field) {
    return getField(field);
  }

  function reset() {
    snapshot.textureMode = 'single';
    snapshot.textureFatigue = 0;
    snapshot.scale = [];
    snapshot.chords = [];
    snapshot.compositeIntensity = 0;
    snapshot.harmonicRhythm = 0;
    snapshot.harmonicMutationCount = 0;
    snapshot.emissionRatio = 1;
    snapshot.extraDensityCorrection = 1;
    snapshot.extraCoherenceDensityBias = 1;
    snapshot.playProb = 0.5;
    snapshot.stutterProb = 0.3;
    snapshot.flicker = 1;
    snapshot.tick = 0;
    snapshot.updatedAt = Date.now();
  }


  return {
    initialize,
    updateFromConductor,
    getSnapshot,
    getField,
    get,
    reset
  };
  },
});
