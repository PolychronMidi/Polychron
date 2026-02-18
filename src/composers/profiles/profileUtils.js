if (typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'undefined' && COMPOSER_TYPE_PROFILE_SOURCES !== null && typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('ComposerProfiles.profileUtils: COMPOSER_TYPE_PROFILE_SOURCES must be an object when pre-defined');
}

if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || COMPOSER_TYPE_PROFILE_SOURCES === null) {
  COMPOSER_TYPE_PROFILE_SOURCES = {};
}

COMPOSER_TYPES = [
  'measure',
  'scale',
  'chords',
  'mode',
  'pentatonic',
  'blues',
  'chromatic',
  'quartal',
  'tensionRelease',
  'modalInterchange',
  'melodicDevelopment',
  'voiceLeading',
  'harmonicRhythm'
];

const MIN_PROFILE_COUNT_BY_TYPE = {
  measure: 6,
  scale: 6,
  chords: 6,
  mode: 6,
  pentatonic: 6,
  blues: 6,
  chromatic: 6,
  quartal: 6,
  tensionRelease: 6,
  modalInterchange: 6,
  melodicDevelopment: 6,
  voiceLeading: 6,
  harmonicRhythm: 6
};

const DIVERSITY_DIMENSIONS_BY_TYPE = {
  measure: ['voiceProfile', 'motifProfile', 'rhythmProfile'],
  scale: ['name', 'root', 'voiceProfile', 'motifProfile'],
  chords: ['progression', 'direction', 'chordProfile', 'rhythmProfile'],
  mode: ['name', 'root', 'voiceProfile', 'motifProfile'],
  pentatonic: ['scaleType', 'root', 'voiceProfile', 'motifProfile'],
  blues: ['bluesType', 'root', 'blueNoteProb', 'voiceProfile', 'motifProfile'],
  chromatic: ['targetScaleName', 'root', 'chromaticDensity', 'voiceProfile', 'motifProfile'],
  quartal: ['scaleName', 'root', 'voicingType', 'stackSize', 'voiceProfile', 'motifProfile'],
  tensionRelease: ['quality', 'tensionCurve', 'enablePhraseArcs', 'phraseTensionScaling', 'chordProfile', 'rhythmProfile'],
  modalInterchange: ['primaryMode', 'borrowProbability', 'chordProfile', 'rhythmProfile'],
  melodicDevelopment: ['inversionMode', 'inversionPivotMode', 'normalizeToScale', 'useDegreeNoise', 'enablePhraseArcs', 'arcScaling', 'voiceProfile', 'motifProfile', 'rhythmProfile'],
  voiceLeading: ['name', 'commonToneWeight', 'contraryMotionPreference', 'voiceProfile', 'motifProfile'],
  harmonicRhythm: ['quality', 'measuresPerChord', 'anticipation', 'settling', 'enablePhraseArcs', 'chordProfile', 'rhythmProfile']
};

const DEFAULT_POOL_SELECTORS = [
  ['measure', 'default'],
  ['measure', 'corpusAdaptive'],
  ['measure', 'accentedCells'],
  ['scale', 'default'],
  ['scale', 'diatonicWander'],
  ['chords', 'default'],
  ['chords', 'iiVICycle'],
  ['mode', 'default'],
  ['mode', 'modalDrift'],
  ['pentatonic', 'default'],
  ['pentatonic', 'majorLift'],
  ['tensionRelease', 'default'],
  ['tensionRelease', 'arcGentle'],
  ['modalInterchange', 'default'],
  ['modalInterchange', 'adventurous'],
  ['melodicDevelopment', 'default'],
  ['melodicDevelopment', 'corpusAdaptive'],
  ['melodicDevelopment', 'lyric'],
  ['melodicDevelopment', 'arcDetached'],
  ['voiceLeading', 'default'],
  ['voiceLeading', 'balanced'],
  ['voiceLeading', 'corpusAdaptive'],
  ['harmonicRhythm', 'default'],
  ['harmonicRhythm', 'corpusAdaptive'],
  ['harmonicRhythm', 'arclessMotorik'],
  ['measure', 'grooveLocked'],
  ['measure', 'suspendedGrid'],
  ['scale', 'harmonicMinorDrift'],
  ['mode', 'lydianFloat'],
  ['mode', 'locrianTension'],
  ['chords', 'minorDescent'],
  ['tensionRelease', 'minorDramatic'],
  ['harmonicRhythm', 'minorAnticipatory'],
  ['blues', 'default'],
  ['blues', 'minorGrit'],
  ['chromatic', 'default'],
  ['chromatic', 'jazzApproach'],
  ['quartal', 'default'],
  ['quartal', 'openFourths']
];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertStringOrFail = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ComposerProfiles: ${label} must be a non-empty string`);
  }
};

const serializeDimensionValue = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value);
};

const resolveNamedProfilesOrFail = (entry, label) => {
  const resolvedProfiles = {};

  if (entry.resolvedProfiles !== undefined) {
    if (!isPlainObject(entry.resolvedProfiles)) {
      throw new Error(`ComposerProfiles: ${label}.resolvedProfiles must be an object`);
    }
    Object.assign(resolvedProfiles, entry.resolvedProfiles);
  }

  if (entry.voiceProfile !== undefined) {
    if (typeof voiceConfig === 'undefined' || !voiceConfig || typeof voiceConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires voiceConfig.getProfile()`);
    }
    resolvedProfiles.voice = voiceConfig.getProfile(entry.voiceProfile);
  }
  if (entry.chordProfile !== undefined) {
    if (typeof chordConfig === 'undefined' || !chordConfig || typeof chordConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires chordConfig.getProfile()`);
    }
    resolvedProfiles.chord = chordConfig.getProfile(entry.chordProfile);
  }
  if (entry.motifProfile !== undefined) {
    if (typeof motifConfig === 'undefined' || !motifConfig || typeof motifConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires motifConfig.getProfile()`);
    }
    resolvedProfiles.motif = motifConfig.getProfile(entry.motifProfile);
  }
  if (entry.rhythmProfile !== undefined) {
    if (typeof rhythmConfig === 'undefined' || !rhythmConfig || typeof rhythmConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires rhythmConfig.getProfile()`);
    }
    resolvedProfiles.rhythm = rhythmConfig.getProfile(entry.rhythmProfile);
  }

  return resolvedProfiles;
};

const cloneComposerEntryOrFail = (entry, label, expectedType = null) => {
  if (typeof ComposerProfileValidation === 'undefined' || !ComposerProfileValidation || typeof ComposerProfileValidation.validateEntryForTypeOrFail !== 'function') {
    throw new Error('ComposerProfiles.cloneComposerEntryOrFail: ComposerProfileValidation.validateEntryForTypeOrFail() is not available');
  }
  ComposerProfileValidation.validateEntryForTypeOrFail(entry, label, expectedType);

  const cloned = Object.assign({}, entry);
  const resolved = resolveNamedProfilesOrFail(cloned, label);
  if (Object.keys(resolved).length > 0) cloned.resolvedProfiles = Object.assign({}, resolved);
  return cloned;
};

const cloneComposerEntriesOrFail = (entries, label, expectedType = null) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`ComposerProfiles: ${label} must be a non-empty array`);
  }
  return entries.map((entry, i) => cloneComposerEntryOrFail(entry, `${label}[${i}]`, expectedType));
};

const pickProfileEntriesOrFail = (typeProfiles, type, profileName) => {
  const profileEntries = typeProfiles[profileName];
  if (!Array.isArray(profileEntries) || profileEntries.length === 0) {
    throw new Error(`ComposerProfiles: profile "${profileName}" missing for type "${type}" while building pools`);
  }
  return cloneComposerEntriesOrFail(profileEntries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`, type);
};

const buildProfileAuditOrFail = (typeProfiles, profilePools) => {
  const byType = {};
  let totalProfileCount = 0;
  let totalEntryCount = 0;

  for (const [type, profiles] of Object.entries(typeProfiles)) {
    const profileNames = Object.keys(profiles).sort();
    const dimensions = {};
    const dimensionSets = {};
    for (const dim of (DIVERSITY_DIMENSIONS_BY_TYPE[type] || [])) dimensionSets[dim] = new Set();

    let entryCount = 0;
    for (const entries of Object.values(profiles)) {
      entryCount += entries.length;
      for (const entry of entries) {
        for (const dim of Object.keys(dimensionSets)) {
          if (entry[dim] !== undefined) dimensionSets[dim].add(serializeDimensionValue(entry[dim]));
        }
      }
    }
    for (const dim of Object.keys(dimensionSets)) dimensions[dim] = Array.from(dimensionSets[dim]).sort();

    totalProfileCount += profileNames.length;
    totalEntryCount += entryCount;
    byType[type] = { profileCount: profileNames.length, entryCount, profileNames, dimensions };
  }

  const poolSizes = {};
  for (const [poolName, entries] of Object.entries(profilePools)) poolSizes[poolName] = entries.length;

  return {
    typeCount: Object.keys(byType).length,
    totalProfileCount,
    totalEntryCount,
    poolSizes,
    byType
  };
};

ComposerProfileUtils = {
  COMPOSER_TYPES,
  MIN_PROFILE_COUNT_BY_TYPE,
  DIVERSITY_DIMENSIONS_BY_TYPE,
  DEFAULT_POOL_SELECTORS,
  isPlainObject,
  assertStringOrFail,
  serializeDimensionValue,
  resolveNamedProfilesOrFail,
  cloneComposerEntryOrFail,
  cloneComposerEntriesOrFail,
  pickProfileEntriesOrFail,
  buildProfileAuditOrFail
};
