COMPOSER_TYPE_PROFILE_SOURCES = {};
// @ts-ignore: load side-effect module with globals
require('./measureProfiles');
// @ts-ignore: load side-effect module with globals
require('./scaleProfiles');
// @ts-ignore: load side-effect module with globals
require('./chordsProfiles');
// @ts-ignore: load side-effect module with globals
require('./modeProfiles');
// @ts-ignore: load side-effect module with globals
require('./pentatonicProfiles');
// @ts-ignore: load side-effect module with globals
require('./tensionReleaseProfiles');
// @ts-ignore: load side-effect module with globals
require('./modalInterchangeProfiles');
// @ts-ignore: load side-effect module with globals
require('./melodicDevelopmentProfiles');
// @ts-ignore: load side-effect module with globals
require('./voiceLeadingProfiles');
// @ts-ignore: load side-effect module with globals
require('./harmonicRhythmProfiles');

const COMPOSER_TYPES = [
  'measure',
  'scale',
  'chords',
  'mode',
  'pentatonic',
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
  tensionRelease: ['quality', 'tensionCurve', 'enablePhraseArcs', 'phraseTensionScaling', 'chordProfile', 'rhythmProfile'],
  modalInterchange: ['primaryMode', 'borrowProbability', 'chordProfile', 'rhythmProfile'],
  melodicDevelopment: ['inversionMode', 'inversionPivotMode', 'normalizeToScale', 'useDegreeNoise', 'enablePhraseArcs', 'arcScaling', 'voiceProfile', 'motifProfile', 'rhythmProfile'],
  voiceLeading: ['name', 'commonToneWeight', 'contraryMotionPreference', 'voiceProfile', 'motifProfile'],
  harmonicRhythm: ['quality', 'measuresPerChord', 'anticipation', 'settling', 'enablePhraseArcs', 'chordProfile', 'rhythmProfile']
};

const PROFILE_NAME_KEYS = ['voiceProfile', 'chordProfile', 'motifProfile', 'rhythmProfile'];
const DIRECTION_SET = new Set(['R', 'L', 'E', '?']);
const ARC_TYPE_SET = new Set(['arch', 'rise-fall', 'build-resolve', 'wave']);

const COMMON_ENTRY_KEYS = ['type', 'voiceProfile', 'chordProfile', 'motifProfile', 'rhythmProfile', 'resolvedProfiles'];
const ALLOWED_KEYS_BY_TYPE = {
  measure: new Set([...COMMON_ENTRY_KEYS]),
  scale: new Set([...COMMON_ENTRY_KEYS, 'name', 'root']),
  chords: new Set([...COMMON_ENTRY_KEYS, 'progression', 'direction']),
  mode: new Set([...COMMON_ENTRY_KEYS, 'name', 'root']),
  pentatonic: new Set([...COMMON_ENTRY_KEYS, 'root', 'scaleType']),
  tensionRelease: new Set([...COMMON_ENTRY_KEYS, 'key', 'quality', 'tensionCurve', 'enablePhraseArcs', 'phraseArcOpts', 'phraseTensionScaling']),
  modalInterchange: new Set([...COMMON_ENTRY_KEYS, 'key', 'primaryMode', 'borrowProbability']),
  melodicDevelopment: new Set([...COMMON_ENTRY_KEYS, 'name', 'root', 'intensity', 'developmentBias', 'inversionMode', 'inversionPivotMode', 'inversionFixedDegree', 'normalizeToScale', 'useDegreeNoise', 'enablePhraseArcs', 'phraseArcOpts', 'arcScaling']),
  voiceLeading: new Set([...COMMON_ENTRY_KEYS, 'name', 'root', 'commonToneWeight', 'contraryMotionPreference']),
  harmonicRhythm: new Set([...COMMON_ENTRY_KEYS, 'progression', 'key', 'measuresPerChord', 'quality', 'changeEmphasis', 'anticipation', 'settling', 'enablePhraseArcs', 'phraseArcOpts', 'phraseBoundaryEmphasis'])
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertStringOrFail = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ComposerProfiles: ${label} must be a non-empty string`);
  }
};

const assertBooleanOrFail = (value, label) => {
  if (typeof value !== 'boolean') {
    throw new Error(`ComposerProfiles: ${label} must be a boolean`);
  }
};

const assertFiniteRangeOrFail = (value, min, max, label) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`ComposerProfiles: ${label} must be a finite number in [${min}, ${max}]`);
  }
};

const assertPositiveFiniteOrFail = (value, label) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`ComposerProfiles: ${label} must be a positive finite number`);
  }
};

const assertIntegerRangeOrFail = (value, min, max, label) => {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
    throw new Error(`ComposerProfiles: ${label} must be an integer in [${min}, ${max}]`);
  }
};

const assertInSetOrFail = (value, allowedSet, label) => {
  if (!allowedSet.has(value)) {
    throw new Error(`ComposerProfiles: ${label} has invalid value "${value}"`);
  }
};

const assertProgressionOrFail = (value, label) => {
  if (value === 'random') return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`ComposerProfiles: ${label} must be "random" or a non-empty array`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || value[i].length === 0) {
      throw new Error(`ComposerProfiles: ${label}[${i}] must be a non-empty string`);
    }
  }
};

const assertPhraseArcOptsOrFail = (value, label) => {
  if (!isPlainObject(value)) {
    throw new Error(`ComposerProfiles: ${label} must be an object`);
  }
  const allowedKeys = new Set(['arcType', 'registerRange', 'densityRange']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`ComposerProfiles: ${label}.${key} is not supported`);
  }
  if (value.arcType !== undefined) {
    assertStringOrFail(value.arcType, `${label}.arcType`);
    assertInSetOrFail(value.arcType, ARC_TYPE_SET, `${label}.arcType`);
  }
  if (value.registerRange !== undefined) {
    assertPositiveFiniteOrFail(value.registerRange, `${label}.registerRange`);
  }
  if (value.densityRange !== undefined) {
    if (!isPlainObject(value.densityRange)) throw new Error(`ComposerProfiles: ${label}.densityRange must be an object`);
    assertPositiveFiniteOrFail(value.densityRange.min, `${label}.densityRange.min`);
    assertPositiveFiniteOrFail(value.densityRange.max, `${label}.densityRange.max`);
    if (Number(value.densityRange.max) < Number(value.densityRange.min)) {
      throw new Error(`ComposerProfiles: ${label}.densityRange.max must be >= min`);
    }
  }
};

const validateAllowedKeysOrFail = (entry, type, label) => {
  const allowedKeys = ALLOWED_KEYS_BY_TYPE[type];
  if (!allowedKeys) throw new Error(`ComposerProfiles: unknown composer type "${type}"`);
  for (const key of Object.keys(entry)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`ComposerProfiles: ${label}.${key} is not a valid key for type "${type}"`);
    }
  }
};

const validateResolvedProfilesShapeOrFail = (entry, label) => {
  if (entry.resolvedProfiles === undefined) return;
  if (!isPlainObject(entry.resolvedProfiles)) {
    throw new Error(`ComposerProfiles: ${label}.resolvedProfiles must be an object`);
  }
  const allowed = new Set(['voice', 'chord', 'motif', 'rhythm']);
  for (const key of Object.keys(entry.resolvedProfiles)) {
    if (!allowed.has(key)) throw new Error(`ComposerProfiles: ${label}.resolvedProfiles.${key} is not supported`);
    if (!isPlainObject(entry.resolvedProfiles[key])) {
      throw new Error(`ComposerProfiles: ${label}.resolvedProfiles.${key} must be an object`);
    }
  }
};

const validateEntryForTypeOrFail = (entry, label, expectedType = null) => {
  if (!isPlainObject(entry)) throw new Error(`ComposerProfiles: ${label} entry must be an object`);
  assertStringOrFail(entry.type, `${label}.type`);

  if (!COMPOSER_TYPES.includes(entry.type)) {
    throw new Error(`ComposerProfiles: ${label}.type "${entry.type}" is unsupported`);
  }
  if (expectedType && entry.type !== expectedType) {
    throw new Error(`ComposerProfiles: ${label}.type must be "${expectedType}"`);
  }

  validateAllowedKeysOrFail(entry, entry.type, label);
  validateResolvedProfilesShapeOrFail(entry, label);

  for (const key of PROFILE_NAME_KEYS) {
    if (entry[key] !== undefined) assertStringOrFail(entry[key], `${label}.${key}`);
  }

  switch (entry.type) {
    case 'measure':
      break;
    case 'scale':
      assertStringOrFail(entry.name, `${label}.name`);
      assertStringOrFail(entry.root, `${label}.root`);
      break;
    case 'chords':
      assertProgressionOrFail(entry.progression, `${label}.progression`);
      assertStringOrFail(entry.direction, `${label}.direction`);
      assertInSetOrFail(entry.direction.toUpperCase(), DIRECTION_SET, `${label}.direction`);
      break;
    case 'mode':
      assertStringOrFail(entry.name, `${label}.name`);
      assertStringOrFail(entry.root, `${label}.root`);
      break;
    case 'pentatonic':
      assertStringOrFail(entry.root, `${label}.root`);
      assertStringOrFail(entry.scaleType, `${label}.scaleType`);
      if (!['major', 'minor', 'random'].includes(String(entry.scaleType).toLowerCase())) {
        throw new Error(`ComposerProfiles: ${label}.scaleType must be major|minor|random`);
      }
      break;
    case 'tensionRelease':
      assertStringOrFail(entry.key, `${label}.key`);
      assertStringOrFail(entry.quality, `${label}.quality`);
      if (!['major', 'minor'].includes(String(entry.quality).toLowerCase())) {
        throw new Error(`ComposerProfiles: ${label}.quality must be major|minor`);
      }
      assertFiniteRangeOrFail(entry.tensionCurve, 0, 1, `${label}.tensionCurve`);
      assertBooleanOrFail(entry.enablePhraseArcs, `${label}.enablePhraseArcs`);
      assertBooleanOrFail(entry.phraseTensionScaling, `${label}.phraseTensionScaling`);
      if (entry.phraseArcOpts !== undefined) assertPhraseArcOptsOrFail(entry.phraseArcOpts, `${label}.phraseArcOpts`);
      break;
    case 'modalInterchange':
      assertStringOrFail(entry.key, `${label}.key`);
      assertStringOrFail(entry.primaryMode, `${label}.primaryMode`);
      if (!['major', 'minor'].includes(String(entry.primaryMode).toLowerCase())) {
        throw new Error(`ComposerProfiles: ${label}.primaryMode must be major|minor`);
      }
      assertFiniteRangeOrFail(entry.borrowProbability, 0, 1, `${label}.borrowProbability`);
      break;
    case 'melodicDevelopment':
      assertStringOrFail(entry.name, `${label}.name`);
      assertStringOrFail(entry.root, `${label}.root`);
      assertFiniteRangeOrFail(entry.intensity, 0, 1, `${label}.intensity`);
      assertFiniteRangeOrFail(entry.developmentBias, 0, 1, `${label}.developmentBias`);
      assertStringOrFail(entry.inversionMode, `${label}.inversionMode`);
      if (!['diatonic', 'chromatic'].includes(String(entry.inversionMode).toLowerCase())) {
        throw new Error(`ComposerProfiles: ${label}.inversionMode must be diatonic|chromatic`);
      }
      assertStringOrFail(entry.inversionPivotMode, `${label}.inversionPivotMode`);
      if (!['first-note', 'median', 'fixed-degree'].includes(String(entry.inversionPivotMode).toLowerCase())) {
        throw new Error(`ComposerProfiles: ${label}.inversionPivotMode must be first-note|median|fixed-degree`);
      }
      if (entry.inversionFixedDegree !== undefined) {
        const inv = Number(entry.inversionFixedDegree);
        if (!Number.isFinite(inv)) throw new Error(`ComposerProfiles: ${label}.inversionFixedDegree must be finite when provided`);
      }
      assertBooleanOrFail(entry.normalizeToScale, `${label}.normalizeToScale`);
      assertBooleanOrFail(entry.useDegreeNoise, `${label}.useDegreeNoise`);
      assertBooleanOrFail(entry.enablePhraseArcs, `${label}.enablePhraseArcs`);
      assertBooleanOrFail(entry.arcScaling, `${label}.arcScaling`);
      if (entry.phraseArcOpts !== undefined) assertPhraseArcOptsOrFail(entry.phraseArcOpts, `${label}.phraseArcOpts`);
      break;
    case 'voiceLeading':
      assertStringOrFail(entry.name, `${label}.name`);
      assertStringOrFail(entry.root, `${label}.root`);
      assertFiniteRangeOrFail(entry.commonToneWeight, 0, 1, `${label}.commonToneWeight`);
      assertFiniteRangeOrFail(entry.contraryMotionPreference, 0, 1, `${label}.contraryMotionPreference`);
      break;
    case 'harmonicRhythm':
      assertProgressionOrFail(entry.progression, `${label}.progression`);
      assertStringOrFail(entry.key, `${label}.key`);
      assertIntegerRangeOrFail(entry.measuresPerChord, 1, 8, `${label}.measuresPerChord`);
      assertStringOrFail(entry.quality, `${label}.quality`);
      if (!['major', 'minor'].includes(String(entry.quality).toLowerCase())) {
        throw new Error(`ComposerProfiles: ${label}.quality must be major|minor`);
      }
      assertPositiveFiniteOrFail(entry.changeEmphasis, `${label}.changeEmphasis`);
      assertBooleanOrFail(entry.anticipation, `${label}.anticipation`);
      assertBooleanOrFail(entry.settling, `${label}.settling`);
      assertBooleanOrFail(entry.enablePhraseArcs, `${label}.enablePhraseArcs`);
      assertPositiveFiniteOrFail(entry.phraseBoundaryEmphasis, `${label}.phraseBoundaryEmphasis`);
      if (entry.phraseArcOpts !== undefined) assertPhraseArcOptsOrFail(entry.phraseArcOpts, `${label}.phraseArcOpts`);
      break;
    default:
      throw new Error(`ComposerProfiles: ${label} unsupported type "${entry.type}"`);
  }
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
  validateEntryForTypeOrFail(entry, label, expectedType);
  const cloned = Object.assign({}, entry);
  const resolved = resolveNamedProfilesOrFail(cloned, label);
  if (Object.keys(resolved).length > 0) {
    cloned.resolvedProfiles = Object.assign({}, resolved);
  }
  return cloned;
};

const cloneComposerEntriesOrFail = (entries, label, expectedType = null) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`ComposerProfiles: ${label} must be a non-empty array`);
  }
  return entries.map((entry, i) => cloneComposerEntryOrFail(entry, `${label}[${i}]`, expectedType));
};

const serializeDimensionValue = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value);
};

const validateDiversityOrFail = (type, profileMap) => {
  const dimensions = DIVERSITY_DIMENSIONS_BY_TYPE[type] || [];
  for (const dim of dimensions) {
    const distinct = new Set();
    for (const entries of Object.values(profileMap)) {
      for (const entry of entries) {
        if (entry[dim] !== undefined) distinct.add(serializeDimensionValue(entry[dim]));
      }
    }
    if (distinct.size < 2) {
      throw new Error(`ComposerProfiles: insufficient diversity for type "${type}" dimension "${dim}" (need >=2 distinct values)`);
    }
  }
};

if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !isPlainObject(COMPOSER_TYPE_PROFILE_SOURCES)) {
  throw new Error('ComposerProfiles: COMPOSER_TYPE_PROFILE_SOURCES is undefined or invalid');
}

const typeProfileTemplates = COMPOSER_TYPE_PROFILE_SOURCES;

COMPOSER_TYPE_PROFILES = {};
for (const [type, profiles] of Object.entries(typeProfileTemplates)) {
  if (!COMPOSER_TYPES.includes(type)) {
    throw new Error(`ComposerProfiles: unknown type source "${type}"`);
  }
  if (!isPlainObject(profiles)) {
    throw new Error(`ComposerProfiles: invalid profile map for type "${type}"`);
  }

  const profileNames = Object.keys(profiles);
  if (!profileNames.includes('default')) {
    throw new Error(`ComposerProfiles: type "${type}" must include a default profile`);
  }

  const minCount = MIN_PROFILE_COUNT_BY_TYPE[type] || 1;
  if (profileNames.length < minCount) {
    throw new Error(`ComposerProfiles: type "${type}" must expose at least ${minCount} profiles`);
  }

  COMPOSER_TYPE_PROFILES[type] = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    assertStringOrFail(profileName, `COMPOSER_TYPE_PROFILES.${type}.profileName`);
    COMPOSER_TYPE_PROFILES[type][profileName] = cloneComposerEntriesOrFail(entries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`, type);
  }

  validateDiversityOrFail(type, COMPOSER_TYPE_PROFILES[type]);
}

const pickProfileEntriesOrFail = (type, profileName) => {
  const typeProfiles = COMPOSER_TYPE_PROFILES[type];
  if (!isPlainObject(typeProfiles)) {
    throw new Error(`ComposerProfiles: unknown type "${type}" while building pools`);
  }
  const profileEntries = typeProfiles[profileName];
  if (!Array.isArray(profileEntries) || profileEntries.length === 0) {
    throw new Error(`ComposerProfiles: profile "${profileName}" missing for type "${type}" while building pools`);
  }
  return cloneComposerEntriesOrFail(profileEntries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`, type);
};

const defaultPoolSelectors = [
  ['measure', 'default'],
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
  ['melodicDevelopment', 'lyric'],
  ['melodicDevelopment', 'arcDetached'],
  ['voiceLeading', 'default'],
  ['voiceLeading', 'balanced'],
  ['harmonicRhythm', 'default'],
  ['harmonicRhythm', 'arclessMotorik']
];

const defaultPoolTemplate = [];
for (const [type, profileName] of defaultPoolSelectors) {
  const entries = pickProfileEntriesOrFail(type, profileName);
  for (const entry of entries) defaultPoolTemplate.push(entry);
}

const fullSpectrumEclecticTemplate = [];
for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILES)) {
  for (const [profileName, entries] of Object.entries(profiles)) {
    const label = `COMPOSER_TYPE_PROFILES.${type}.${profileName}`;
    const cloned = cloneComposerEntriesOrFail(entries, label, type);
    for (const entry of cloned) fullSpectrumEclecticTemplate.push(entry);
  }
}

COMPOSER_PROFILE_POOLS = {
  default: cloneComposerEntriesOrFail(defaultPoolTemplate, 'COMPOSER_PROFILE_POOLS.default'),
  fullSpectrumEclectic: cloneComposerEntriesOrFail(fullSpectrumEclecticTemplate, 'COMPOSER_PROFILE_POOLS.fullSpectrumEclectic')
};

const buildProfileAuditOrFail = () => {
  const byType = {};
  let totalProfileCount = 0;
  let totalEntryCount = 0;

  for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILES)) {
    const profileNames = Object.keys(profiles).sort();
    const dimensions = {};
    const dimensionSets = {};
    for (const dim of (DIVERSITY_DIMENSIONS_BY_TYPE[type] || [])) {
      dimensionSets[dim] = new Set();
    }

    let entryCount = 0;
    for (const entries of Object.values(profiles)) {
      entryCount += entries.length;
      for (const entry of entries) {
        for (const dim of Object.keys(dimensionSets)) {
          if (entry[dim] !== undefined) dimensionSets[dim].add(serializeDimensionValue(entry[dim]));
        }
      }
    }

    for (const dim of Object.keys(dimensionSets)) {
      dimensions[dim] = Array.from(dimensionSets[dim]).sort();
    }

    totalProfileCount += profileNames.length;
    totalEntryCount += entryCount;
    byType[type] = {
      profileCount: profileNames.length,
      entryCount,
      profileNames,
      dimensions
    };
  }

  const poolSizes = {};
  for (const [poolName, entries] of Object.entries(COMPOSER_PROFILE_POOLS)) {
    poolSizes[poolName] = entries.length;
  }

  return {
    typeCount: Object.keys(byType).length,
    totalProfileCount,
    totalEntryCount,
    poolSizes,
    byType
  };
};

COMPOSER_PROFILE_AUDIT = buildProfileAuditOrFail();

getComposerTypeProfilesOrFail = (type) => {
  assertStringOrFail(type, 'ComposerProfiles.getComposerTypeProfilesOrFail.type');
  const profiles = COMPOSER_TYPE_PROFILES[type];
  if (!isPlainObject(profiles)) throw new Error(`ComposerProfiles.getComposerTypeProfilesOrFail: unknown composer type "${type}"`);

  const cloned = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    cloned[profileName] = cloneComposerEntriesOrFail(entries, `getComposerTypeProfilesOrFail(${type}).${profileName}`, type);
  }
  return cloned;
};

getComposerTypeProfileOrFail = (type, profileName = 'default') => {
  assertStringOrFail(type, 'ComposerProfiles.getComposerTypeProfileOrFail.type');
  assertStringOrFail(profileName, 'ComposerProfiles.getComposerTypeProfileOrFail.profileName');

  const profiles = COMPOSER_TYPE_PROFILES[type];
  if (!isPlainObject(profiles)) throw new Error(`ComposerProfiles.getComposerTypeProfileOrFail: unknown composer type "${type}"`);

  const profile = profiles[profileName];
  if (!Array.isArray(profile) || profile.length === 0) {
    throw new Error(`ComposerProfiles.getComposerTypeProfileOrFail: profile "${profileName}" not found for type "${type}"`);
  }
  return cloneComposerEntriesOrFail(profile, `getComposerTypeProfileOrFail(${type},${profileName})`, type);
};

getComposerPoolOrFail = (poolName = 'default') => {
  assertStringOrFail(poolName, 'ComposerProfiles.getComposerPoolOrFail.poolName');
  const pool = COMPOSER_PROFILE_POOLS[poolName];
  if (!Array.isArray(pool) || pool.length === 0) throw new Error(`ComposerProfiles.getComposerPoolOrFail: pool "${poolName}" is missing or empty`);
  return cloneComposerEntriesOrFail(pool, `getComposerPoolOrFail(${poolName})`);
};

getDefaultComposerPoolOrFail = () => getComposerPoolOrFail('default');

getComposerProfileAuditOrFail = () => JSON.parse(JSON.stringify(COMPOSER_PROFILE_AUDIT));
