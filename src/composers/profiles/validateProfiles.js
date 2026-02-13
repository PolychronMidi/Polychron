if (typeof ComposerProfileUtils === 'undefined' || !ComposerProfileUtils || typeof ComposerProfileUtils.isPlainObject !== 'function') {
  throw new Error('ComposerProfiles.validateProfiles: ComposerProfileUtils is unavailable');
}

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

const assertBooleanOrFail = (value, label) => {
  if (typeof value !== 'boolean') throw new Error(`ComposerProfiles: ${label} must be a boolean`);
};
const assertFiniteRangeOrFail = (value, min, max, label) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) throw new Error(`ComposerProfiles: ${label} must be a finite number in [${min}, ${max}]`);
};
const assertPositiveFiniteOrFail = (value, label) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) throw new Error(`ComposerProfiles: ${label} must be a positive finite number`);
};
const assertIntegerRangeOrFail = (value, min, max, label) => {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) throw new Error(`ComposerProfiles: ${label} must be an integer in [${min}, ${max}]`);
};
const assertInSetOrFail = (value, allowedSet, label) => {
  if (!allowedSet.has(value)) throw new Error(`ComposerProfiles: ${label} has invalid value "${value}"`);
};
const assertProgressionOrFail = (value, label) => {
  if (value === 'random') return;
  if (!Array.isArray(value) || value.length === 0) throw new Error(`ComposerProfiles: ${label} must be "random" or a non-empty array`);
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || value[i].length === 0) throw new Error(`ComposerProfiles: ${label}[${i}] must be a non-empty string`);
  }
};

const assertPhraseArcOptsOrFail = (value, label) => {
  if (!ComposerProfileUtils.isPlainObject(value)) throw new Error(`ComposerProfiles: ${label} must be an object`);
  const allowedKeys = new Set(['arcType', 'registerRange', 'densityRange']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`ComposerProfiles: ${label}.${key} is not supported`);
  }
  if (value.arcType !== undefined) {
    ComposerProfileUtils.assertStringOrFail(value.arcType, `${label}.arcType`);
    assertInSetOrFail(value.arcType, ARC_TYPE_SET, `${label}.arcType`);
  }
  if (value.registerRange !== undefined) assertPositiveFiniteOrFail(value.registerRange, `${label}.registerRange`);
  if (value.densityRange !== undefined) {
    if (!ComposerProfileUtils.isPlainObject(value.densityRange)) throw new Error(`ComposerProfiles: ${label}.densityRange must be an object`);
    assertPositiveFiniteOrFail(value.densityRange.min, `${label}.densityRange.min`);
    assertPositiveFiniteOrFail(value.densityRange.max, `${label}.densityRange.max`);
    if (Number(value.densityRange.max) < Number(value.densityRange.min)) throw new Error(`ComposerProfiles: ${label}.densityRange.max must be >= min`);
  }
};

const validateAllowedKeysOrFail = (entry, type, label) => {
  const allowedKeys = ALLOWED_KEYS_BY_TYPE[type];
  if (!allowedKeys) throw new Error(`ComposerProfiles: unknown composer type "${type}"`);
  for (const key of Object.keys(entry)) {
    if (!allowedKeys.has(key)) throw new Error(`ComposerProfiles: ${label}.${key} is not a valid key for type "${type}"`);
  }
};

const validateResolvedProfilesShapeOrFail = (entry, label) => {
  if (entry.resolvedProfiles === undefined) return;
  if (!ComposerProfileUtils.isPlainObject(entry.resolvedProfiles)) throw new Error(`ComposerProfiles: ${label}.resolvedProfiles must be an object`);
  const allowed = new Set(['voice', 'chord', 'motif', 'rhythm']);
  for (const key of Object.keys(entry.resolvedProfiles)) {
    if (!allowed.has(key)) throw new Error(`ComposerProfiles: ${label}.resolvedProfiles.${key} is not supported`);
    if (!ComposerProfileUtils.isPlainObject(entry.resolvedProfiles[key])) throw new Error(`ComposerProfiles: ${label}.resolvedProfiles.${key} must be an object`);
  }
};

const validateByType = {
  measure: () => {},
  scale: (entry, label) => {
    ComposerProfileUtils.assertStringOrFail(entry.name, `${label}.name`);
    ComposerProfileUtils.assertStringOrFail(entry.root, `${label}.root`);
  },
  chords: (entry, label) => {
    assertProgressionOrFail(entry.progression, `${label}.progression`);
    ComposerProfileUtils.assertStringOrFail(entry.direction, `${label}.direction`);
    assertInSetOrFail(entry.direction.toUpperCase(), DIRECTION_SET, `${label}.direction`);
  },
  mode: (entry, label) => {
    ComposerProfileUtils.assertStringOrFail(entry.name, `${label}.name`);
    ComposerProfileUtils.assertStringOrFail(entry.root, `${label}.root`);
  },
  pentatonic: (entry, label) => {
    ComposerProfileUtils.assertStringOrFail(entry.root, `${label}.root`);
    ComposerProfileUtils.assertStringOrFail(entry.scaleType, `${label}.scaleType`);
    if (!['major', 'minor', 'random'].includes(String(entry.scaleType).toLowerCase())) throw new Error(`ComposerProfiles: ${label}.scaleType must be major|minor|random`);
  },
  tensionRelease: (entry, label) => {
    ComposerProfileUtils.assertStringOrFail(entry.key, `${label}.key`);
    ComposerProfileUtils.assertStringOrFail(entry.quality, `${label}.quality`);
    if (!['major', 'minor'].includes(String(entry.quality).toLowerCase())) throw new Error(`ComposerProfiles: ${label}.quality must be major|minor`);
    assertFiniteRangeOrFail(entry.tensionCurve, 0, 1, `${label}.tensionCurve`);
    assertBooleanOrFail(entry.enablePhraseArcs, `${label}.enablePhraseArcs`);
    assertBooleanOrFail(entry.phraseTensionScaling, `${label}.phraseTensionScaling`);
    if (entry.phraseArcOpts !== undefined) assertPhraseArcOptsOrFail(entry.phraseArcOpts, `${label}.phraseArcOpts`);
  },
  modalInterchange: (entry, label) => {
    ComposerProfileUtils.assertStringOrFail(entry.key, `${label}.key`);
    ComposerProfileUtils.assertStringOrFail(entry.primaryMode, `${label}.primaryMode`);
    if (!['major', 'minor'].includes(String(entry.primaryMode).toLowerCase())) throw new Error(`ComposerProfiles: ${label}.primaryMode must be major|minor`);
    assertFiniteRangeOrFail(entry.borrowProbability, 0, 1, `${label}.borrowProbability`);
  },
  melodicDevelopment: (entry, label) => {
    ComposerProfileUtils.assertStringOrFail(entry.name, `${label}.name`);
    ComposerProfileUtils.assertStringOrFail(entry.root, `${label}.root`);
    assertFiniteRangeOrFail(entry.intensity, 0, 1, `${label}.intensity`);
    assertFiniteRangeOrFail(entry.developmentBias, 0, 1, `${label}.developmentBias`);
    ComposerProfileUtils.assertStringOrFail(entry.inversionMode, `${label}.inversionMode`);
    if (!['diatonic', 'chromatic'].includes(String(entry.inversionMode).toLowerCase())) throw new Error(`ComposerProfiles: ${label}.inversionMode must be diatonic|chromatic`);
    ComposerProfileUtils.assertStringOrFail(entry.inversionPivotMode, `${label}.inversionPivotMode`);
    if (!['first-note', 'median', 'fixed-degree'].includes(String(entry.inversionPivotMode).toLowerCase())) throw new Error(`ComposerProfiles: ${label}.inversionPivotMode must be first-note|median|fixed-degree`);
    if (entry.inversionFixedDegree !== undefined && !Number.isFinite(Number(entry.inversionFixedDegree))) throw new Error(`ComposerProfiles: ${label}.inversionFixedDegree must be finite when provided`);
    assertBooleanOrFail(entry.normalizeToScale, `${label}.normalizeToScale`);
    assertBooleanOrFail(entry.useDegreeNoise, `${label}.useDegreeNoise`);
    assertBooleanOrFail(entry.enablePhraseArcs, `${label}.enablePhraseArcs`);
    assertBooleanOrFail(entry.arcScaling, `${label}.arcScaling`);
    if (entry.phraseArcOpts !== undefined) assertPhraseArcOptsOrFail(entry.phraseArcOpts, `${label}.phraseArcOpts`);
  },
  voiceLeading: (entry, label) => {
    ComposerProfileUtils.assertStringOrFail(entry.name, `${label}.name`);
    ComposerProfileUtils.assertStringOrFail(entry.root, `${label}.root`);
    assertFiniteRangeOrFail(entry.commonToneWeight, 0, 1, `${label}.commonToneWeight`);
    assertFiniteRangeOrFail(entry.contraryMotionPreference, 0, 1, `${label}.contraryMotionPreference`);
  },
  harmonicRhythm: (entry, label) => {
    assertProgressionOrFail(entry.progression, `${label}.progression`);
    ComposerProfileUtils.assertStringOrFail(entry.key, `${label}.key`);
    assertIntegerRangeOrFail(entry.measuresPerChord, 1, 8, `${label}.measuresPerChord`);
    ComposerProfileUtils.assertStringOrFail(entry.quality, `${label}.quality`);
    if (!['major', 'minor'].includes(String(entry.quality).toLowerCase())) throw new Error(`ComposerProfiles: ${label}.quality must be major|minor`);
    assertPositiveFiniteOrFail(entry.changeEmphasis, `${label}.changeEmphasis`);
    assertBooleanOrFail(entry.anticipation, `${label}.anticipation`);
    assertBooleanOrFail(entry.settling, `${label}.settling`);
    assertBooleanOrFail(entry.enablePhraseArcs, `${label}.enablePhraseArcs`);
    assertPositiveFiniteOrFail(entry.phraseBoundaryEmphasis, `${label}.phraseBoundaryEmphasis`);
    if (entry.phraseArcOpts !== undefined) assertPhraseArcOptsOrFail(entry.phraseArcOpts, `${label}.phraseArcOpts`);
  }
};

const validateEntryForTypeOrFail = (entry, label, expectedType = null) => {
  if (!ComposerProfileUtils.isPlainObject(entry)) throw new Error(`ComposerProfiles: ${label} entry must be an object`);
  ComposerProfileUtils.assertStringOrFail(entry.type, `${label}.type`);

  if (!ComposerProfileUtils.COMPOSER_TYPES.includes(entry.type)) {
    throw new Error(`ComposerProfiles: ${label}.type "${entry.type}" is unsupported`);
  }
  if (expectedType && entry.type !== expectedType) {
    throw new Error(`ComposerProfiles: ${label}.type must be "${expectedType}"`);
  }

  validateAllowedKeysOrFail(entry, entry.type, label);
  validateResolvedProfilesShapeOrFail(entry, label);
  for (const key of PROFILE_NAME_KEYS) {
    if (entry[key] !== undefined) ComposerProfileUtils.assertStringOrFail(entry[key], `${label}.${key}`);
  }

  const validator = validateByType[entry.type];
  if (typeof validator !== 'function') throw new Error(`ComposerProfiles: ${label} unsupported type "${entry.type}"`);
  validator(entry, label);
};

const validateDiversityOrFail = (type, profileMap) => {
  const dimensions = ComposerProfileUtils.DIVERSITY_DIMENSIONS_BY_TYPE[type] || [];
  for (const dim of dimensions) {
    const distinct = new Set();
    for (const entries of Object.values(profileMap)) {
      for (const entry of entries) {
        if (entry[dim] !== undefined) distinct.add(ComposerProfileUtils.serializeDimensionValue(entry[dim]));
      }
    }
    if (distinct.size < 2) {
      throw new Error(`ComposerProfiles: insufficient diversity for type "${type}" dimension "${dim}" (need >=2 distinct values)`);
    }
  }
};

const getAllowedKeysByTypeOrFail = () => {
  const out = {};
  for (const [type, keySet] of Object.entries(ALLOWED_KEYS_BY_TYPE)) {
    out[type] = Array.from(keySet.values()).sort();
  }
  return out;
};

ComposerProfileValidation = {
  validateEntryForTypeOrFail,
  validateDiversityOrFail,
  getAllowedKeysByTypeOrFail
};
