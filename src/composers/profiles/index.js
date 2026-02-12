// @ts-ignore: load side-effect module with globals
require('./profileRegistry');
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

const resolveNamedProfilesOrFail = (entry, label) => {
  const resolvedProfiles = {};

  if (entry.voiceProfile !== undefined) {
    if (typeof entry.voiceProfile !== 'string' || entry.voiceProfile.length === 0) {
      throw new Error(`ComposerProfiles: ${label}.voiceProfile must be a non-empty string`);
    }
    if (typeof voiceConfig === 'undefined' || !voiceConfig || typeof voiceConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires voiceConfig.getProfile()`);
    }
    resolvedProfiles.voice = voiceConfig.getProfile(entry.voiceProfile);
  }

  if (entry.chordProfile !== undefined) {
    if (typeof entry.chordProfile !== 'string' || entry.chordProfile.length === 0) {
      throw new Error(`ComposerProfiles: ${label}.chordProfile must be a non-empty string`);
    }
    if (typeof chordConfig === 'undefined' || !chordConfig || typeof chordConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires chordConfig.getProfile()`);
    }
    resolvedProfiles.chord = chordConfig.getProfile(entry.chordProfile);
  }

  if (entry.motifProfile !== undefined) {
    if (typeof entry.motifProfile !== 'string' || entry.motifProfile.length === 0) {
      throw new Error(`ComposerProfiles: ${label}.motifProfile must be a non-empty string`);
    }
    if (typeof motifConfig === 'undefined' || !motifConfig || typeof motifConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires motifConfig.getProfile()`);
    }
    resolvedProfiles.motif = motifConfig.getProfile(entry.motifProfile);
  }

  if (entry.rhythmProfile !== undefined) {
    if (typeof entry.rhythmProfile !== 'string' || entry.rhythmProfile.length === 0) {
      throw new Error(`ComposerProfiles: ${label}.rhythmProfile must be a non-empty string`);
    }
    if (typeof rhythmConfig === 'undefined' || !rhythmConfig || typeof rhythmConfig.getProfile !== 'function') {
      throw new Error(`ComposerProfiles: ${label} requires rhythmConfig.getProfile()`);
    }
    resolvedProfiles.rhythm = rhythmConfig.getProfile(entry.rhythmProfile);
  }

  return resolvedProfiles;
};

const cloneComposerEntryOrFail = (entry, label) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`ComposerProfiles: ${label} entry must be an object`);
  }
  if (typeof entry.type !== 'string' || entry.type.length === 0) {
    throw new Error(`ComposerProfiles: ${label} entry.type must be a non-empty string`);
  }

  const cloned = Object.assign({}, entry);
  const resolved = resolveNamedProfilesOrFail(cloned, label);
  if (Object.keys(resolved).length > 0) {
    cloned.resolvedProfiles = Object.assign({}, resolved);
  }
  return cloned;
};

const cloneComposerEntriesOrFail = (entries, label) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`ComposerProfiles: ${label} must be a non-empty array`);
  }
  return entries.map((entry, i) => cloneComposerEntryOrFail(entry, `${label}[${i}]`));
};

if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !COMPOSER_TYPE_PROFILE_SOURCES || typeof COMPOSER_TYPE_PROFILE_SOURCES !== 'object') {
  throw new Error('ComposerProfiles: COMPOSER_TYPE_PROFILE_SOURCES is undefined or invalid');
}

const typeProfileTemplates = COMPOSER_TYPE_PROFILE_SOURCES;

COMPOSER_TYPE_PROFILES = {};
for (const [type, profiles] of Object.entries(typeProfileTemplates)) {
  if (!profiles || typeof profiles !== 'object') throw new Error(`ComposerProfiles: invalid profile map for type "${type}"`);
  if (!Array.isArray(profiles.default) || profiles.default.length === 0) throw new Error(`ComposerProfiles: type "${type}" must include a non-empty default profile`);

  COMPOSER_TYPE_PROFILES[type] = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    COMPOSER_TYPE_PROFILES[type][profileName] = cloneComposerEntriesOrFail(entries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`);
  }
}

const pickProfileEntriesOrFail = (type, profileName) => {
  const typeProfiles = COMPOSER_TYPE_PROFILES[type];
  if (!typeProfiles || typeof typeProfiles !== 'object') {
    throw new Error(`ComposerProfiles: unknown type "${type}" while building pools`);
  }
  const profileEntries = typeProfiles[profileName];
  if (!Array.isArray(profileEntries) || profileEntries.length === 0) {
    throw new Error(`ComposerProfiles: profile "${profileName}" missing for type "${type}" while building pools`);
  }
  return cloneComposerEntriesOrFail(profileEntries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`);
};

const defaultPoolSelectors = [
  ['scale', 'default'],
  ['scale', 'diatonicWander'],
  ['chords', 'default'],
  ['chords', 'iiVICycle'],
  ['mode', 'default'],
  ['mode', 'modalDrift'],
  ['pentatonic', 'default'],
  ['pentatonic', 'majorLift'],
  ['tensionRelease', 'default'],
  ['modalInterchange', 'default'],
  ['melodicDevelopment', 'default'],
  ['melodicDevelopment', 'lyric'],
  ['melodicDevelopment', 'volatile'],
  ['voiceLeading', 'default'],
  ['voiceLeading', 'balanced'],
  ['harmonicRhythm', 'default']
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
