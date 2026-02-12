const cloneComposerEntryOrFail = (entry, label) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`ComposerProfiles: ${label} entry must be an object`);
  }
  if (typeof entry.type !== 'string' || entry.type.length === 0) {
    throw new Error(`ComposerProfiles: ${label} entry.type must be a non-empty string`);
  }
  return Object.assign({}, entry);
};

const cloneComposerEntriesOrFail = (entries, label) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`ComposerProfiles: ${label} must be a non-empty array`);
  }
  return entries.map((entry, i) => cloneComposerEntryOrFail(entry, `${label}[${i}]`));
};

const typeProfileTemplates = {
  measure: {
    default: [{ type: 'measure' }],
    sparse: [{ type: 'measure' }],
    pulse: [{ type: 'measure' }]
  },
  scale: {
    default: [{ type: 'scale', name: 'major', root: 'random' }],
    diatonicWander: [{ type: 'scale', name: 'random', root: 'random' }],
    brightCenter: [{ type: 'scale', name: 'major', root: 'C' }]
  },
  chords: {
    default: [{ type: 'chords', progression: 'random' }],
    lushCycle: [{ type: 'chords', progression: ['Cmaj7', 'Am7', 'Dm7', 'G7'] }],
    triadicPulse: [{ type: 'chords', progression: ['C', 'F', 'G', 'C'] }]
  },
  mode: {
    default: [{ type: 'mode', name: 'ionian', root: 'random' }],
    modalDrift: [{ type: 'mode', name: 'random', root: 'random' }],
    anchoredIonian: [{ type: 'mode', name: 'ionian', root: 'C' }]
  },
  pentatonic: {
    default: [{ type: 'pentatonic', root: 'random', scaleType: 'random' }],
    majorLift: [{ type: 'pentatonic', root: 'random', scaleType: 'major' }],
    minorMist: [{ type: 'pentatonic', root: 'random', scaleType: 'minor' }]
  },
  tensionRelease: {
    default: [{ type: 'tensionRelease', quality: 'major', tensionCurve: 0.6 }],
    arcGentle: [{ type: 'tensionRelease', quality: 'major', tensionCurve: 0.4 }],
    arcSteep: [{ type: 'tensionRelease', quality: 'major', tensionCurve: 0.8 }]
  },
  modalInterchange: {
    default: [{ type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.3 }],
    conservative: [{ type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.2 }],
    adventurous: [{ type: 'modalInterchange', primaryMode: 'minor', borrowProbability: 0.45 }]
  },
  melodicDevelopment: {
    default: [{ type: 'melodicDevelopment', name: 'major', root: 'random', intensity: 0.6 }],
    lyric: [{ type: 'melodicDevelopment', name: 'major', root: 'random', intensity: 0.4 }],
    volatile: [{ type: 'melodicDevelopment', name: 'random', root: 'random', intensity: 0.7 }]
  },
  voiceLeading: {
    default: [{ type: 'voiceLeading', name: 'major', root: 'random', commonToneWeight: 0.7 }],
    open: [{ type: 'voiceLeading', name: 'random', root: 'random', commonToneWeight: 0.5 }],
    tight: [{ type: 'voiceLeading', name: 'random', root: 'random', commonToneWeight: 0.8 }]
  },
  harmonicRhythm: {
    default: [{ type: 'harmonicRhythm', progression: ['I', 'IV', 'V', 'I'], key: 'random', measuresPerChord: 2, quality: 'major' }],
    patientGrid: [{ type: 'harmonicRhythm', progression: ['I', 'vi', 'IV', 'V'], key: 'random', measuresPerChord: 3, quality: 'major' }],
    activeGrid: [{ type: 'harmonicRhythm', progression: ['I', 'V', 'vi', 'IV'], key: 'random', measuresPerChord: 1, quality: 'major' }]
  }
};

COMPOSER_TYPE_PROFILES = {};
for (const [type, profiles] of Object.entries(typeProfileTemplates)) {
  if (!profiles || typeof profiles !== 'object') throw new Error(`ComposerProfiles: invalid profile map for type "${type}"`);
  if (!Array.isArray(profiles.default) || profiles.default.length === 0) throw new Error(`ComposerProfiles: type "${type}" must include a non-empty default profile`);

  COMPOSER_TYPE_PROFILES[type] = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    COMPOSER_TYPE_PROFILES[type][profileName] = cloneComposerEntriesOrFail(entries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`);
  }
}

const defaultPoolTemplate = [
  { type: 'scale', name: 'major', root: 'random' },
  { type: 'chords', progression: 'random' },
  { type: 'mode', name: 'ionian', root: 'random' },
  { type: 'scale', name: 'random', root: 'random' },
  { type: 'scale', name: 'major', root: 'random' },
  { type: 'chords', progression: 'random' },
  { type: 'mode', name: 'ionian', root: 'random' },
  { type: 'mode', name: 'random', root: 'random' },
  { type: 'pentatonic', root: 'random', scaleType: 'random' },
  { type: 'pentatonic', root: 'random', scaleType: 'random' },
  { type: 'tensionRelease', quality: 'major', tensionCurve: 0.6 },
  { type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.3 },
  { type: 'melodicDevelopment', name: 'major', root: 'random', intensity: 0.6 },
  { type: 'melodicDevelopment', name: 'major', root: 'random', intensity: 0.4 },
  { type: 'melodicDevelopment', name: 'random', root: 'random', intensity: 0.5 },
  { type: 'melodicDevelopment', name: 'random', root: 'random', intensity: 0.7 },
  { type: 'voiceLeading', name: 'major', root: 'random', commonToneWeight: 0.7 },
  { type: 'voiceLeading', name: 'major', root: 'random', commonToneWeight: 0.5 },
  { type: 'voiceLeading', name: 'random', root: 'random', commonToneWeight: 0.6 },
  { type: 'voiceLeading', name: 'random', root: 'random', commonToneWeight: 0.8 },
  { type: 'harmonicRhythm', progression: ['I', 'IV', 'V', 'I'], key: 'random', measuresPerChord: 2, quality: 'major' }
];

const fullSpectrumEclecticTemplate = [];
for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILES)) {
  for (const [profileName, entries] of Object.entries(profiles)) {
    const label = `COMPOSER_TYPE_PROFILES.${type}.${profileName}`;
    const cloned = cloneComposerEntriesOrFail(entries, label);
    for (const entry of cloned) fullSpectrumEclecticTemplate.push(entry);
  }
}

COMPOSER_PROFILE_POOLS = {
  default: cloneComposerEntriesOrFail(defaultPoolTemplate, 'COMPOSER_PROFILE_POOLS.default'),
  fullSpectrumEclectic: cloneComposerEntriesOrFail(fullSpectrumEclecticTemplate, 'COMPOSER_PROFILE_POOLS.fullSpectrumEclectic')
};

getComposerTypeProfilesOrFail = (type) => {
  if (typeof type !== 'string' || type.length === 0) throw new Error('ComposerProfiles.getComposerTypeProfilesOrFail: type must be a non-empty string');
  const profiles = COMPOSER_TYPE_PROFILES[type];
  if (!profiles || typeof profiles !== 'object') throw new Error(`ComposerProfiles.getComposerTypeProfilesOrFail: unknown composer type "${type}"`);
  return profiles;
};

getComposerTypeProfileOrFail = (type, profileName = 'default') => {
  const profiles = getComposerTypeProfilesOrFail(type);
  if (typeof profileName !== 'string' || profileName.length === 0) throw new Error('ComposerProfiles.getComposerTypeProfileOrFail: profileName must be a non-empty string');
  const profile = profiles[profileName];
  if (!Array.isArray(profile) || profile.length === 0) throw new Error(`ComposerProfiles.getComposerTypeProfileOrFail: profile "${profileName}" not found for type "${type}"`);
  return cloneComposerEntriesOrFail(profile, `getComposerTypeProfileOrFail(${type},${profileName})`);
};

getComposerPoolOrFail = (poolName = 'default') => {
  if (typeof poolName !== 'string' || poolName.length === 0) throw new Error('ComposerProfiles.getComposerPoolOrFail: poolName must be a non-empty string');
  const pool = COMPOSER_PROFILE_POOLS[poolName];
  if (!Array.isArray(pool) || pool.length === 0) throw new Error(`ComposerProfiles.getComposerPoolOrFail: pool "${poolName}" is missing or empty`);
  return cloneComposerEntriesOrFail(pool, `getComposerPoolOrFail(${poolName})`);
};

getDefaultComposerPoolOrFail = () => getComposerPoolOrFail('default');
