ConductorState = (() => {
  let initialized = false;

  const snapshot = {
    key: 'C',
    mode: 'major',
    quality: 'major',
    tension: 0,
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
    activeProfile: 'default',
    journeyMove: 'origin',
    journeyDistance: 0,
    journeyKey: 'C',
    journeyMode: 'major',
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
    if (Number.isFinite(Number(state.tension))) snapshot.tension = clamp(Number(state.tension), 0, 1);
    if (Number.isFinite(Number(state.excursion))) snapshot.excursion = m.max(0, Number(state.excursion));
    if (typeof state.sectionPhase === 'string' && state.sectionPhase.length > 0) snapshot.sectionPhase = state.sectionPhase;
  }

  function writeRegulationFromConductor() {
    if (typeof ConductorConfig === 'undefined' || !ConductorConfig) return;

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
    if (typeof EventBus === 'undefined' || !EventBus || typeof EventBus.on !== 'function') return false;

    EventBus.on('texture-contrast', (data) => {
      if (!data || typeof data !== 'object') return;
      if (typeof data.mode === 'string' && data.mode.length > 0) snapshot.textureMode = data.mode;
      if (Number.isFinite(Number(data.composite))) snapshot.compositeIntensity = clamp(Number(data.composite), 0, 1);
      if (typeof TextureBlender !== 'undefined' && TextureBlender && typeof TextureBlender.getRecentDensity === 'function') {
        snapshot.textureFatigue = clamp(Number(TextureBlender.getRecentDensity()), 0, 1);
      }
      snapshot.updatedAt = Date.now();
    });

    EventBus.on('journey-move', (data) => {
      if (!data || typeof data !== 'object') return;
      if (typeof data.move === 'string' && data.move.length > 0) snapshot.journeyMove = data.move;
      if (Number.isFinite(Number(data.distance))) snapshot.journeyDistance = m.max(0, Number(data.distance));
      if (typeof data.key === 'string' && data.key.length > 0) snapshot.journeyKey = data.key;
      if (typeof data.mode === 'string' && data.mode.length > 0) snapshot.journeyMode = data.mode;
      snapshot.updatedAt = Date.now();
    });

    EventBus.on('conductor-regulation', (data) => {
      if (!data || typeof data !== 'object') return;
      if (Number.isFinite(Number(data.densityBias))) snapshot.densityBias = Number(data.densityBias);
      if (Number.isFinite(Number(data.crossModBias))) snapshot.crossModBias = Number(data.crossModBias);
      if (typeof data.profile === 'string' && data.profile.length > 0) snapshot.activeProfile = data.profile;
      snapshot.updatedAt = Date.now();
    });

    EventBus.on('section-boundary', () => {
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

  function reset() {
    snapshot.textureMode = 'single';
    snapshot.textureFatigue = 0;
    snapshot.compositeIntensity = 0;
    snapshot.playProb = 0.5;
    snapshot.stutterProb = 0.3;
    snapshot.tick = 0;
    snapshot.updatedAt = Date.now();
  }

  return {
    initialize,
    updateFromConductor,
    getSnapshot,
    reset
  };
})();
