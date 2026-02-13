if (typeof ComposerProfileUtils === 'undefined' || !ComposerProfileUtils || typeof ComposerProfileUtils.isPlainObject !== 'function') {
  throw new Error('ComposerProfiles.profileRegistry: ComposerProfileUtils is unavailable');
}
if (typeof ComposerProfileValidation === 'undefined' || !ComposerProfileValidation || typeof ComposerProfileValidation.validateDiversityOrFail !== 'function') {
  throw new Error('ComposerProfiles.profileRegistry: ComposerProfileValidation is unavailable');
}
if (typeof COMPOSER_TYPE_PROFILE_SOURCES === 'undefined' || !ComposerProfileUtils.isPlainObject(COMPOSER_TYPE_PROFILE_SOURCES)) {
  throw new Error('ComposerProfiles.profileRegistry: COMPOSER_TYPE_PROFILE_SOURCES is undefined or invalid');
}

COMPOSER_TYPE_PROFILES = {};

for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILE_SOURCES)) {
  if (!ComposerProfileUtils.COMPOSER_TYPES.includes(type)) {
    throw new Error(`ComposerProfiles: unknown type source "${type}"`);
  }
  if (!ComposerProfileUtils.isPlainObject(profiles)) {
    throw new Error(`ComposerProfiles: invalid profile map for type "${type}"`);
  }

  const profileNames = Object.keys(profiles);
  if (!profileNames.includes('default')) throw new Error(`ComposerProfiles: type "${type}" must include a default profile`);

  const minCount = ComposerProfileUtils.MIN_PROFILE_COUNT_BY_TYPE[type] || 1;
  if (profileNames.length < minCount) {
    throw new Error(`ComposerProfiles: type "${type}" must expose at least ${minCount} profiles`);
  }

  COMPOSER_TYPE_PROFILES[type] = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    ComposerProfileUtils.assertStringOrFail(profileName, `COMPOSER_TYPE_PROFILES.${type}.profileName`);
    COMPOSER_TYPE_PROFILES[type][profileName] = ComposerProfileUtils.cloneComposerEntriesOrFail(entries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`, type);
  }

  ComposerProfileValidation.validateDiversityOrFail(type, COMPOSER_TYPE_PROFILES[type]);
}

const defaultPoolTemplate = [];
for (const [type, profileName] of ComposerProfileUtils.DEFAULT_POOL_SELECTORS) {
  const typeProfiles = COMPOSER_TYPE_PROFILES[type];
  if (!ComposerProfileUtils.isPlainObject(typeProfiles)) {
    throw new Error(`ComposerProfiles: unknown type "${type}" while building pools`);
  }
  const entries = ComposerProfileUtils.pickProfileEntriesOrFail(typeProfiles, type, profileName);
  for (const entry of entries) defaultPoolTemplate.push(entry);
}

const fullSpectrumEclecticTemplate = [];
for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILES)) {
  for (const [profileName, entries] of Object.entries(profiles)) {
    const label = `COMPOSER_TYPE_PROFILES.${type}.${profileName}`;
    const cloned = ComposerProfileUtils.cloneComposerEntriesOrFail(entries, label, type);
    for (const entry of cloned) fullSpectrumEclecticTemplate.push(entry);
  }
}

COMPOSER_PROFILE_POOLS = {
  default: ComposerProfileUtils.cloneComposerEntriesOrFail(defaultPoolTemplate, 'COMPOSER_PROFILE_POOLS.default'),
  fullSpectrumEclectic: ComposerProfileUtils.cloneComposerEntriesOrFail(fullSpectrumEclecticTemplate, 'COMPOSER_PROFILE_POOLS.fullSpectrumEclectic')
};

COMPOSER_PROFILE_AUDIT = ComposerProfileUtils.buildProfileAuditOrFail(COMPOSER_TYPE_PROFILES, COMPOSER_PROFILE_POOLS);

getComposerTypeProfilesOrFail = (type) => {
  ComposerProfileUtils.assertStringOrFail(type, 'ComposerProfiles.getComposerTypeProfilesOrFail.type');
  const profiles = COMPOSER_TYPE_PROFILES[type];
  if (!ComposerProfileUtils.isPlainObject(profiles)) {
    throw new Error(`ComposerProfiles.getComposerTypeProfilesOrFail: unknown composer type "${type}"`);
  }

  const cloned = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    cloned[profileName] = ComposerProfileUtils.cloneComposerEntriesOrFail(entries, `getComposerTypeProfilesOrFail(${type}).${profileName}`, type);
  }
  return cloned;
};

getComposerTypeProfileOrFail = (type, profileName = 'default') => {
  ComposerProfileUtils.assertStringOrFail(type, 'ComposerProfiles.getComposerTypeProfileOrFail.type');
  ComposerProfileUtils.assertStringOrFail(profileName, 'ComposerProfiles.getComposerTypeProfileOrFail.profileName');

  const profiles = COMPOSER_TYPE_PROFILES[type];
  if (!ComposerProfileUtils.isPlainObject(profiles)) {
    throw new Error(`ComposerProfiles.getComposerTypeProfileOrFail: unknown composer type "${type}"`);
  }

  const profile = profiles[profileName];
  if (!Array.isArray(profile) || profile.length === 0) {
    throw new Error(`ComposerProfiles.getComposerTypeProfileOrFail: profile "${profileName}" not found for type "${type}"`);
  }

  return ComposerProfileUtils.cloneComposerEntriesOrFail(profile, `getComposerTypeProfileOrFail(${type},${profileName})`, type);
};

getComposerPoolOrFail = (poolName = 'default') => {
  ComposerProfileUtils.assertStringOrFail(poolName, 'ComposerProfiles.getComposerPoolOrFail.poolName');
  const pool = COMPOSER_PROFILE_POOLS[poolName];
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error(`ComposerProfiles.getComposerPoolOrFail: pool "${poolName}" is missing or empty`);
  }
  return ComposerProfileUtils.cloneComposerEntriesOrFail(pool, `getComposerPoolOrFail(${poolName})`);
};

getDefaultComposerPoolOrFail = () => getComposerPoolOrFail('default');

getComposerProfileAuditOrFail = () => JSON.parse(JSON.stringify(COMPOSER_PROFILE_AUDIT));
