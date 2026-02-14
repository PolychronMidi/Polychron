if (typeof ComposerProfileUtils === 'undefined' || !ComposerProfileUtils || typeof ComposerProfileUtils.isPlainObject !== 'function') {
  throw new Error('ComposerProfiles.runtimeProfileAdapter: ComposerProfileUtils is unavailable');
}

const isFiniteNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    if (value.trim().length === 0) return false;
    return Number.isFinite(Number(value));
  }
  return false;
};

const toFiniteOrDefault = (value, fallback) => {
  if (!isFiniteNumber(value)) return fallback;
  return Number(value);
};

const resolveRuntimeProfilesOrFail = (config = {}, label = 'ComposerRuntimeProfileAdapter.resolveRuntimeProfilesOrFail') => {
  if (!ComposerProfileUtils.isPlainObject(config)) {
    throw new Error(`${label}: config must be an object`);
  }
  if (typeof ComposerProfileUtils.resolveNamedProfilesOrFail !== 'function') {
    throw new Error(`${label}: ComposerProfileUtils.resolveNamedProfilesOrFail() not available`);
  }
  return ComposerProfileUtils.resolveNamedProfilesOrFail(config, `${label}.config`);
};

const buildNormalizedRuntimeProfileOrFail = (resolvedProfiles = {}, opts = {}) => {
  if (!ComposerProfileUtils.isPlainObject(resolvedProfiles)) {
    throw new Error('ComposerRuntimeProfileAdapter.buildNormalizedRuntimeProfileOrFail: resolvedProfiles must be an object');
  }

  const chord = ComposerProfileUtils.isPlainObject(resolvedProfiles.chord) ? resolvedProfiles.chord : null;
  const voice = ComposerProfileUtils.isPlainObject(resolvedProfiles.voice) ? resolvedProfiles.voice : null;
  const motif = ComposerProfileUtils.isPlainObject(resolvedProfiles.motif) ? resolvedProfiles.motif : null;
  const rhythm = ComposerProfileUtils.isPlainObject(resolvedProfiles.rhythm) ? resolvedProfiles.rhythm : null;

  const baseVelocityPrecedence = Array.isArray(opts.baseVelocityPrecedence) && opts.baseVelocityPrecedence.length > 0
    ? opts.baseVelocityPrecedence
    : ['chord', 'voice'];

  const baseVelocityBySource = {
    chord: chord && isFiniteNumber(chord.baseVelocity) ? Number(chord.baseVelocity) : null,
    voice: voice && isFiniteNumber(voice.baseVelocity) ? Number(voice.baseVelocity) : null
  };

  let baseVelocity = null;
  let baseVelocitySource = null;
  for (const source of baseVelocityPrecedence) {
    if (!Object.prototype.hasOwnProperty.call(baseVelocityBySource, source)) continue;
    const next = baseVelocityBySource[source];
    if (isFiniteNumber(next)) {
      baseVelocity = Number(next);
      baseVelocitySource = source;
    }
  }

  const chordVelocityScale = toFiniteOrDefault(chord && chord.velocityScale, 1);
  const motifVelocityScale = toFiniteOrDefault(motif && motif.velocityScale, 1);
  const rhythmVelocityScale = toFiniteOrDefault(rhythm && rhythm.velocityScale, 1);
  const velocityScale = chordVelocityScale * motifVelocityScale * rhythmVelocityScale;

  const timingOffsetUnits = toFiniteOrDefault(motif && motif.timingOffset, 0);
  const swingAmount = toFiniteOrDefault(rhythm && rhythm.swing, 0);

  const inversionPreference = chord && isFiniteNumber(chord.inversion) ? Number(chord.inversion) : null;
  const chordVoices = chord && isFiniteNumber(chord.voices) ? m.max(1, m.round(Number(chord.voices))) : null;
  const voiceCountMultiplier = chordVoices !== null ? clamp(chordVoices / 4, 0.5, 2) : 1;
  const useCorpusVoiceLeadingPriors = Boolean(voice && voice.useCorpusVoiceLeadingPriors === true);
  const corpusVoiceLeadingStrength = useCorpusVoiceLeadingPriors
    ? clamp(toFiniteOrDefault(voice && voice.corpusVoiceLeadingStrength, 0.8), 0, 2)
    : 0;
  const useCorpusMelodicPriors = Boolean(voice && voice.useCorpusMelodicPriors === true);
  const corpusMelodicStrength = useCorpusMelodicPriors
    ? clamp(toFiniteOrDefault(voice && voice.corpusMelodicStrength, 0.75), 0, 2)
    : 0;
  const useCorpusHarmonicPriors = Boolean(chord && chord.useCorpusHarmonicPriors === true);
  const corpusHarmonicStrength = useCorpusHarmonicPriors
    ? clamp(toFiniteOrDefault(chord && chord.corpusHarmonicStrength, 0.55), 0, 1)
    : 0;

  return {
    namedProfiles: Object.assign({}, resolvedProfiles),
    chord,
    voice,
    motif,
    rhythm,
    baseVelocity,
    baseVelocitySource,
    chordVelocityScale,
    motifVelocityScale,
    rhythmVelocityScale,
    velocityScale,
    timingOffsetUnits,
    swingAmount,
    inversionPreference,
    chordVoices,
    voiceCountMultiplier,
    useCorpusVoiceLeadingPriors,
    corpusVoiceLeadingStrength,
    useCorpusMelodicPriors,
    corpusMelodicStrength,
    useCorpusHarmonicPriors,
    corpusHarmonicStrength
  };
};

const applyToComposerOrFail = (composer, runtimeProfile = {}) => {
  if (!composer || typeof composer !== 'object') {
    throw new Error('ComposerRuntimeProfileAdapter.applyToComposerOrFail: composer must be an object');
  }
  if (!ComposerProfileUtils.isPlainObject(runtimeProfile)) {
    throw new Error('ComposerRuntimeProfileAdapter.applyToComposerOrFail: runtimeProfile must be an object');
  }

  composer.runtimeProfile = Object.assign({}, runtimeProfile);

  const namedProfiles = ComposerProfileUtils.isPlainObject(runtimeProfile.namedProfiles)
    ? runtimeProfile.namedProfiles
    : {};
  composer.profileConfigs = Object.assign({}, composer.profileConfigs || {}, namedProfiles);

  if (composer.intervalOptions && typeof composer.intervalOptions === 'object' && Array.isArray(composer.notes) && composer.notes.length > 0) {
    if (isFiniteNumber(runtimeProfile.chordVoices)) {
      const boundedVoices = m.max(1, m.min(composer.notes.length, m.round(Number(runtimeProfile.chordVoices))));
      composer.intervalOptions.minNotes = boundedVoices;
      composer.intervalOptions.maxNotes = boundedVoices;
    }

    if (isFiniteNumber(runtimeProfile.inversionPreference)) {
      const sourceCount = composer.notes.length;
      if (sourceCount > 0) {
        const inversion = ((m.round(Number(runtimeProfile.inversionPreference)) % sourceCount) + sourceCount) % sourceCount;
        const priorPrefer = Array.isArray(composer.intervalOptions.preferIndices)
          ? composer.intervalOptions.preferIndices.slice()
          : [];
        if (!priorPrefer.includes(inversion)) {
          composer.intervalOptions.preferIndices = [inversion, ...priorPrefer];
        } else {
          composer.intervalOptions.preferIndices = priorPrefer;
        }
      }
    }
  }

  if (isFiniteNumber(runtimeProfile.baseVelocity)) composer.baseVelocity = Number(runtimeProfile.baseVelocity);
  if (typeof runtimeProfile.baseVelocitySource === 'string' && runtimeProfile.baseVelocitySource) {
    composer.baseVelocitySource = runtimeProfile.baseVelocitySource;
  }

  composer.chordVelocityScale = toFiniteOrDefault(runtimeProfile.chordVelocityScale, 1);
  composer.motifVelocityScale = toFiniteOrDefault(runtimeProfile.motifVelocityScale, 1);
  composer.rhythmVelocityScale = toFiniteOrDefault(runtimeProfile.rhythmVelocityScale, 1);
  composer.profileVelocityScale = toFiniteOrDefault(runtimeProfile.velocityScale, 1);
  composer.profileTimingOffsetUnits = toFiniteOrDefault(runtimeProfile.timingOffsetUnits, 0);
  composer.profileSwingAmount = toFiniteOrDefault(runtimeProfile.swingAmount, 0);
  composer.profileVoiceCountMultiplier = toFiniteOrDefault(runtimeProfile.voiceCountMultiplier, 1);
  composer.useCorpusVoiceLeadingPriors = runtimeProfile.useCorpusVoiceLeadingPriors === true;
  composer.corpusVoiceLeadingStrength = toFiniteOrDefault(runtimeProfile.corpusVoiceLeadingStrength, 0);
  composer.useCorpusMelodicPriors = runtimeProfile.useCorpusMelodicPriors === true;
  composer.corpusMelodicStrength = toFiniteOrDefault(runtimeProfile.corpusMelodicStrength, 0);
  composer.useCorpusHarmonicPriors = runtimeProfile.useCorpusHarmonicPriors === true;
  composer.corpusHarmonicStrength = toFiniteOrDefault(runtimeProfile.corpusHarmonicStrength, 0);

  if (isFiniteNumber(runtimeProfile.inversionPreference)) {
    composer.chordInversionPreference = Number(runtimeProfile.inversionPreference);
  }

  return composer;
};

const getVoiceSelectionOptions = (runtimeProfile = null) => {
  if (!runtimeProfile || typeof runtimeProfile !== 'object') return {};
  const options = {};
  if (isFiniteNumber(runtimeProfile.voiceCountMultiplier)) {
    options.voiceCountMultiplier = Number(runtimeProfile.voiceCountMultiplier);
  }
  if (runtimeProfile.useCorpusVoiceLeadingPriors === true) {
    options.useCorpusVoiceLeadingPriors = true;
    options.corpusVoiceLeadingStrength = toFiniteOrDefault(runtimeProfile.corpusVoiceLeadingStrength, 0.8);
  }
  if (runtimeProfile.useCorpusMelodicPriors === true) {
    options.useCorpusMelodicPriors = true;
    options.corpusMelodicStrength = toFiniteOrDefault(runtimeProfile.corpusMelodicStrength, 0.75);
  }
  return options;
};

const getEmissionAdjustments = (runtimeProfile = null) => {
  if (!runtimeProfile || typeof runtimeProfile !== 'object') {
    return { baseVelocity: null, velocityScale: 1, timingOffsetUnits: 0, swingAmount: 0 };
  }
  return {
    baseVelocity: isFiniteNumber(runtimeProfile.baseVelocity) ? Number(runtimeProfile.baseVelocity) : null,
    velocityScale: toFiniteOrDefault(runtimeProfile.velocityScale, 1),
    timingOffsetUnits: toFiniteOrDefault(runtimeProfile.timingOffsetUnits, 0),
    swingAmount: toFiniteOrDefault(runtimeProfile.swingAmount, 0)
  };
};

ComposerRuntimeProfileAdapter = {
  resolveRuntimeProfilesOrFail,
  buildNormalizedRuntimeProfileOrFail,
  applyToComposerOrFail,
  getVoiceSelectionOptions,
  getEmissionAdjustments
};
