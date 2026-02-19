ConductorState = (() => {
  const V = Validator.create('ConductorState');

  let initialized = false;

  const snapshot = {
    key: 'C',
    mode: 'major',
    quality: 'major',
    scale: [],
    chords: [],
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
    textureMode: 'single',
    textureFatigue: 0,
    densityBias: 0,
    crossModBias: 1,
    emissionRatio: 1,
    activeProfile: 'default',
    journeyMove: 'origin',
    journeyDistance: 0,
    journeyKey: 'C',
    journeyMode: 'major',
    binauralFreqOffset: 0,
    binauralFlip: false,
    tick: 0,
    updatedAt: 0
  };

  function writeHarmonicFromContext() {
    if (typeof HarmonicContext === 'undefined' || !HarmonicContext || typeof HarmonicContext.get !== 'function') return;
    const state = HarmonicContext.get();
    if (!state || typeof state !== 'object') return;

    if (typeof state.key === 'string' && state.key.length > 0) snapshot.key = state.key;
    if (typeof state.mode === 'string' && state.mode.length > 0) snapshot.mode = state.mode;
    if (typeof state.quality === 'string' && state.quality.length > 0) snapshot.quality = state.quality;
    if (Array.isArray(state.scale)) snapshot.scale = state.scale.slice();
    if (Array.isArray(state.chords)) snapshot.chords = state.chords.slice();
    if (Number.isFinite(Number(state.tension))) snapshot.tension = clamp(Number(state.tension), 0, 1);
    if (Number.isFinite(Number(state.mutationCount))) snapshot.harmonicMutationCount = m.max(0, Number(state.mutationCount));
    if (Number.isFinite(Number(state.excursion))) snapshot.excursion = m.max(0, Number(state.excursion));
    if (typeof state.sectionPhase === 'string' && state.sectionPhase.length > 0) snapshot.sectionPhase = state.sectionPhase;
  }

  function writeRegulationFromConductor() {
    if (typeof ConductorConfig.getRegulationDensityBias === 'function') {
      const densityBias = Number(ConductorConfig.getRegulationDensityBias());
      if (Number.isFinite(densityBias)) snapshot.densityBias = densityBias;
    }

    if (typeof ConductorConfig.getRegulationCrossModBias === 'function') {
      const crossModBias = Number(ConductorConfig.getRegulationCrossModBias());
      if (Number.isFinite(crossModBias)) snapshot.crossModBias = crossModBias;
    }

    if (typeof ConductorConfig.getActiveProfileName === 'function') {
      const activeProfile = ConductorConfig.getActiveProfileName();
      if (typeof activeProfile === 'string' && activeProfile.length > 0) snapshot.activeProfile = activeProfile;
    }
  }

  function updateFromConductor(data = {}) {
    if (!data || typeof data !== 'object') {
      throw new Error('ConductorState.updateFromConductor: data must be an object');
    }

    // Cast to any to satisfy TS/CheckJS when reading dynamically-shaped payloads
    const _data = /** @type {any} */ (data);

    writeHarmonicFromContext();
    writeRegulationFromConductor();

    const phraseCtx = (_data.phraseCtx && typeof _data.phraseCtx === 'object')
      ? _data.phraseCtx
      : (typeof ComposerFactory !== 'undefined' && ComposerFactory && ComposerFactory.sharedPhraseArcManager && typeof ComposerFactory.sharedPhraseArcManager.getPhraseContext === 'function')
        ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
        : null;

    if (phraseCtx) {
      if (Number.isFinite(Number(phraseCtx.position))) snapshot.phrasePosition = clamp(Number(phraseCtx.position), 0, 1);
      if (typeof phraseCtx.phase === 'string' && phraseCtx.phase.length > 0) snapshot.phrasePhase = phraseCtx.phase;
      if (Number.isFinite(Number(phraseCtx.dynamism))) snapshot.phraseDynamism = clamp(Number(phraseCtx.dynamism), 0, 1);
      if (Number.isFinite(Number(phraseCtx.registerBias))) snapshot.registerBias = Number(phraseCtx.registerBias);
      if (Number.isFinite(Number(phraseCtx.densityMultiplier))) snapshot.densityMultiplier = Number(phraseCtx.densityMultiplier);
      if (Number.isFinite(Number(phraseCtx.voiceIndependence))) snapshot.voiceIndependence = clamp(Number(phraseCtx.voiceIndependence), 0, 1);
    }

    if (Number.isFinite(Number(_data.compositeIntensity))) snapshot.compositeIntensity = clamp(Number(_data.compositeIntensity), 0, 1);
    if (Number.isFinite(Number(_data.harmonicRhythm))) snapshot.harmonicRhythm = clamp(Number(_data.harmonicRhythm), 0, 1);
    if (Number.isFinite(Number(_data.emissionRatio))) snapshot.emissionRatio = clamp(Number(_data.emissionRatio), 0, 2);
    if (Number.isFinite(Number(_data.playProb))) snapshot.playProb = clamp(Number(_data.playProb), 0, 1);
    if (Number.isFinite(Number(_data.stutterProb))) snapshot.stutterProb = clamp(Number(_data.stutterProb), 0, 1);

    if (typeof TextureBlender !== 'undefined' && TextureBlender && typeof TextureBlender.getRecentDensity === 'function') {
      snapshot.textureFatigue = clamp(Number(TextureBlender.getRecentDensity()), 0, 1);
    }

    if (Number.isFinite(Number(beatStart))) snapshot.tick = Number(beatStart);
    snapshot.updatedAt = Date.now();
  }

  function initialize() {
    if (initialized) return true;
    const EVENTS = V.getEventsOrThrow();

    EventBus.on(EVENTS.TEXTURE_CONTRAST, (data) => {
      if (typeof data.mode === 'string' && data.mode.length > 0) snapshot.textureMode = data.mode;
      if (Number.isFinite(Number(data.composite))) snapshot.compositeIntensity = clamp(Number(data.composite), 0, 1);
      if (typeof TextureBlender !== 'undefined' && TextureBlender && typeof TextureBlender.getRecentDensity === 'function') {
        snapshot.textureFatigue = clamp(Number(TextureBlender.getRecentDensity()), 0, 1);
      }
      snapshot.updatedAt = Date.now();
    });

    EventBus.on(EVENTS.JOURNEY_MOVE, (data) => {
      if (typeof data.move === 'string' && data.move.length > 0) snapshot.journeyMove = data.move;
      if (Number.isFinite(Number(data.distance))) snapshot.journeyDistance = m.max(0, Number(data.distance));
      if (typeof data.key === 'string' && data.key.length > 0) snapshot.journeyKey = data.key;
      if (typeof data.mode === 'string' && data.mode.length > 0) snapshot.journeyMode = data.mode;
      snapshot.updatedAt = Date.now();
    });

    EventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
      if (Number.isFinite(Number(data.densityBias))) snapshot.densityBias = Number(data.densityBias);
      if (Number.isFinite(Number(data.crossModBias))) snapshot.crossModBias = Number(data.crossModBias);
      if (typeof data.profile === 'string' && data.profile.length > 0) snapshot.activeProfile = data.profile;
      snapshot.updatedAt = Date.now();
    });

    EventBus.on(EVENTS.HARMONIC_CHANGE, (data) => {
      if (typeof data.key === 'string' && data.key.length > 0) snapshot.key = data.key;
      if (typeof data.mode === 'string' && data.mode.length > 0) snapshot.mode = data.mode;
      if (typeof data.quality === 'string' && data.quality.length > 0) snapshot.quality = data.quality;
      if (Array.isArray(data.scale)) snapshot.scale = data.scale.slice();
      if (Array.isArray(data.chords)) snapshot.chords = data.chords.slice();
      if (typeof data.sectionPhase === 'string' && data.sectionPhase.length > 0) snapshot.sectionPhase = data.sectionPhase;
      if (Number.isFinite(Number(data.excursion))) snapshot.excursion = m.max(0, Number(data.excursion));
      if (Number.isFinite(Number(data.tension))) snapshot.tension = clamp(Number(data.tension), 0, 1);
      if (Number.isFinite(Number(data.mutationCount))) snapshot.harmonicMutationCount = m.max(0, Number(data.mutationCount));
      if (typeof HarmonicRhythmTracker !== 'undefined' && HarmonicRhythmTracker && typeof HarmonicRhythmTracker.getHarmonicRhythm === 'function') {
        snapshot.harmonicRhythm = clamp(Number(HarmonicRhythmTracker.getHarmonicRhythm()), 0, 1);
      }
      snapshot.updatedAt = Date.now();
    });

    EventBus.on(EVENTS.BEAT_BINAURAL_APPLIED, (data) => {
      if (Number.isFinite(Number(data.freqOffset))) snapshot.binauralFreqOffset = Number(data.freqOffset);
      if (typeof data.flipBin === 'boolean') snapshot.binauralFlip = data.flipBin;
      snapshot.updatedAt = Date.now();
    });

    EventBus.on(EVENTS.SECTION_BOUNDARY, () => {
      snapshot.textureMode = 'single';
      snapshot.textureFatigue = 0;
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
      throw new Error(`ConductorState.getField: unknown field "${field}"`);
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
    snapshot.binauralFreqOffset = 0;
    snapshot.binauralFlip = false;
    snapshot.playProb = 0.5;
    snapshot.stutterProb = 0.3;
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
})();
