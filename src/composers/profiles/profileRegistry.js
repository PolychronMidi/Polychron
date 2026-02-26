COMPOSER_TYPE_PROFILES = {};

for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILE_SOURCES)) {
  if (!composerProfileUtils.COMPOSER_TYPES.includes(type)) {
    throw new Error(`ComposerProfiles: unknown type source "${type}"`);
  }
  if (!composerProfileUtils.isPlainObject(profiles)) {
    throw new Error(`ComposerProfiles: invalid profile map for type "${type}"`);
  }

  const profileNames = Object.keys(profiles);
  if (!profileNames.includes('default')) throw new Error(`ComposerProfiles: type "${type}" must include a default profile`);

  const minCount = composerProfileUtils.MIN_PROFILE_COUNT_BY_TYPE[type] || 1;
  if (profileNames.length < minCount) {
    throw new Error(`ComposerProfiles: type "${type}" must expose at least ${minCount} profiles`);
  }

  COMPOSER_TYPE_PROFILES[type] = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    composerProfileUtils.assertStringOrFail(profileName, `COMPOSER_TYPE_PROFILES.${type}.profileName`);
    COMPOSER_TYPE_PROFILES[type][profileName] = composerProfileUtils.cloneComposerEntriesOrFail(entries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`, type);
  }

  composerProfileValidation.validateDiversityOrFail(type, COMPOSER_TYPE_PROFILES[type]);
}

const defaultPoolTemplate = [];
for (const [type, profileName] of composerProfileUtils.DEFAULT_POOL_SELECTORS) {
  const typeProfiles = COMPOSER_TYPE_PROFILES[type];
  if (!composerProfileUtils.isPlainObject(typeProfiles)) {
    throw new Error(`ComposerProfiles: unknown type "${type}" while building pools`);
  }
  const entries = composerProfileUtils.pickProfileEntriesOrFail(typeProfiles, type, profileName);
  for (const entry of entries) defaultPoolTemplate.push(entry);
}

const fullSpectrumEclecticTemplate = [];
for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILES)) {
  for (const [profileName, entries] of Object.entries(profiles)) {
    const label = `COMPOSER_TYPE_PROFILES.${type}.${profileName}`;
    const cloned = composerProfileUtils.cloneComposerEntriesOrFail(entries, label, type);
    for (const entry of cloned) fullSpectrumEclecticTemplate.push(entry);
  }
}

COMPOSER_PROFILE_POOLS = {
  default: composerProfileUtils.cloneComposerEntriesOrFail(defaultPoolTemplate, 'COMPOSER_PROFILE_POOLS.default'),
  fullSpectrumEclectic: composerProfileUtils.cloneComposerEntriesOrFail(fullSpectrumEclecticTemplate, 'COMPOSER_PROFILE_POOLS.fullSpectrumEclectic')
};

if (COMPOSER_POOL_SELECTION_STRATEGY !== null && !composerProfileUtils.isPlainObject(COMPOSER_POOL_SELECTION_STRATEGY)) {
  throw new Error('ComposerProfiles.profileRegistry: COMPOSER_POOL_SELECTION_STRATEGY must be an object when pre-defined');
}
if (COMPOSER_POOL_SELECTION_STRATEGY === null) {
  COMPOSER_POOL_SELECTION_STRATEGY = {
    version: 1,
    name: 'context-strategy-v1',
    defaultPool: 'default',
    // Deploy fullSpectrumEclectic on every 3rd section (remainder 2 = typically development/climax territory)
    sectionModuloRules: [
      { mod: 3, remainder: 2, pool: 'fullSpectrumEclectic' }
    ],
    // Deploy fullSpectrumEclectic on every 4th phrase within a section for variety
    phraseModuloRules: [
      { mod: 4, remainder: 3, pool: 'fullSpectrumEclectic' }
    ]
  };
}

const getAvailablePoolNames = () => Object.keys(COMPOSER_PROFILE_POOLS).sort();

const assertPoolExistsOrFail = (poolName, label) => {
  composerProfileUtils.assertStringOrFail(poolName, label);
  if (!Object.prototype.hasOwnProperty.call(COMPOSER_PROFILE_POOLS, poolName)) {
    throw new Error(`ComposerProfiles: ${label} references unknown pool "${poolName}"`);
  }
};

const resolveRulePoolOrNull = (rules, index, label) => {
  if (!Array.isArray(rules) || !Number.isInteger(index)) return null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const ruleLabel = `${label}[${i}]`;
    if (!composerProfileUtils.isPlainObject(rule)) throw new Error(`ComposerProfiles: ${ruleLabel} must be an object`);

    const mod = Number(rule.mod);
    const remainder = Number(rule.remainder);
    const pool = rule.pool;

    if (!Number.isInteger(mod) || mod <= 0) throw new Error(`ComposerProfiles: ${ruleLabel}.mod must be a positive integer`);
    if (!Number.isInteger(remainder) || remainder < 0 || remainder >= mod) throw new Error(`ComposerProfiles: ${ruleLabel}.remainder must be an integer in [0, mod)`);
    assertPoolExistsOrFail(pool, `${ruleLabel}.pool`);

    if ((index % mod) === remainder) return pool;
  }
  return null;
};

const normalizeStrategyOrFail = (strategy = COMPOSER_POOL_SELECTION_STRATEGY) => {
  if (!composerProfileUtils.isPlainObject(strategy)) {
    throw new Error('ComposerProfiles.selectComposerPoolOrFail: strategy must be an object');
  }
  const normalized = {
    version: Number.isFinite(Number(strategy.version)) ? Number(strategy.version) : 1,
    name: (typeof strategy.name === 'string' && strategy.name.length > 0) ? strategy.name : 'context-strategy-v1',
    defaultPool: (typeof strategy.defaultPool === 'string' && strategy.defaultPool.length > 0) ? strategy.defaultPool : 'default',
    sectionModuloRules: Array.isArray(strategy.sectionModuloRules) ? strategy.sectionModuloRules : [],
    phraseModuloRules: Array.isArray(strategy.phraseModuloRules) ? strategy.phraseModuloRules : []
  };
  assertPoolExistsOrFail(normalized.defaultPool, 'ComposerProfiles.selectionStrategy.defaultPool');
  return normalized;
};

const resolveContextPoolNameOrNull = (context, strategy) => {
  if (!composerProfileUtils.isPlainObject(context)) return null;

  if (context.composerPool !== undefined) {
    assertPoolExistsOrFail(context.composerPool, 'ComposerProfiles.context.composerPool');
    return context.composerPool;
  }

  if (typeof context.selectComposerPool === 'function') {
    const selected = context.selectComposerPool({
      availablePools: getAvailablePoolNames(),
      defaultPool: strategy.defaultPool,
      sectionIndex: Number.isInteger(context.sectionIndex) ? context.sectionIndex : null,
      phraseIndex: Number.isInteger(context.phraseIndex) ? context.phraseIndex : null,
      measureIndex: Number.isInteger(context.measureIndex) ? context.measureIndex : null,
      strategy
    });
    if (selected !== undefined && selected !== null) {
      assertPoolExistsOrFail(selected, 'ComposerProfiles.context.selectComposerPool.result');
      return selected;
    }
  }

  const policy = composerProfileUtils.isPlainObject(context.composerPoolPolicy) ? context.composerPoolPolicy : null;
  const sectionRules = policy && Array.isArray(policy.sectionModuloRules)
    ? policy.sectionModuloRules
    : strategy.sectionModuloRules;
  const phraseRules = policy && Array.isArray(policy.phraseModuloRules)
    ? policy.phraseModuloRules
    : strategy.phraseModuloRules;

  const fromSection = resolveRulePoolOrNull(sectionRules, Number.isInteger(context.sectionIndex) ? context.sectionIndex : null, 'ComposerProfiles.sectionModuloRules');
  if (fromSection) return fromSection;

  const fromPhrase = resolveRulePoolOrNull(phraseRules, Number.isInteger(context.phraseIndex) ? context.phraseIndex : null, 'ComposerProfiles.phraseModuloRules');
  if (fromPhrase) return fromPhrase;

  if (policy && policy.defaultPool !== undefined) {
    assertPoolExistsOrFail(policy.defaultPool, 'ComposerProfiles.context.composerPoolPolicy.defaultPool');
    return policy.defaultPool;
  }

  return null;
};

selectComposerPoolOrFail = (opts = {}) => {
  if (!composerProfileUtils.isPlainObject(opts)) throw new Error('ComposerProfiles.selectComposerPoolOrFail: opts must be an object');
  const strategy = normalizeStrategyOrFail(opts.strategy || COMPOSER_POOL_SELECTION_STRATEGY);

  const requestedPool = opts.requestedPoolName !== undefined ? opts.requestedPoolName : opts.poolName;
  if (requestedPool !== undefined && requestedPool !== null) {
    assertPoolExistsOrFail(requestedPool, 'ComposerProfiles.selectComposerPoolOrFail.requestedPoolName');
    return requestedPool;
  }

  const context = opts.context;
  if (context !== undefined && context !== null && !composerProfileUtils.isPlainObject(context)) {
    throw new Error('ComposerProfiles.selectComposerPoolOrFail: opts.context must be an object when provided');
  }
  const fromContext = resolveContextPoolNameOrNull(context || null, strategy);
  if (fromContext) return fromContext;

  return strategy.defaultPool;
};

// COMPOSER_PROFILE_AUDIT removed (definition-only, never consumed at runtime)
// getComposerProfileAuditOrFail removed (never called outside profileRegistry.js)

getComposerTypeProfilesOrFail = (type) => {
  composerProfileUtils.assertStringOrFail(type, 'ComposerProfiles.getComposerTypeProfilesOrFail.type');
  const profiles = COMPOSER_TYPE_PROFILES[type];
  if (!composerProfileUtils.isPlainObject(profiles)) {
    throw new Error(`ComposerProfiles.getComposerTypeProfilesOrFail: unknown composer type "${type}"`);
  }

  const cloned = {};
  for (const [profileName, entries] of Object.entries(profiles)) {
    cloned[profileName] = composerProfileUtils.cloneComposerEntriesOrFail(entries, `getComposerTypeProfilesOrFail(${type}).${profileName}`, type);
  }
  return cloned;
};

getComposerTypeProfileOrFail = (type, profileName = 'default') => {
  composerProfileUtils.assertStringOrFail(type, 'ComposerProfiles.getComposerTypeProfileOrFail.type');
  composerProfileUtils.assertStringOrFail(profileName, 'ComposerProfiles.getComposerTypeProfileOrFail.profileName');

  const profiles = COMPOSER_TYPE_PROFILES[type];
  if (!composerProfileUtils.isPlainObject(profiles)) {
    throw new Error(`ComposerProfiles.getComposerTypeProfileOrFail: unknown composer type "${type}"`);
  }

  const profile = profiles[profileName];
  if (!Array.isArray(profile) || profile.length === 0) {
    throw new Error(`ComposerProfiles.getComposerTypeProfileOrFail: profile "${profileName}" not found for type "${type}"`);
  }

  return composerProfileUtils.cloneComposerEntriesOrFail(profile, `getComposerTypeProfileOrFail(${type},${profileName})`, type);
};

getComposerPoolOrFail = (poolName = 'default') => {
  composerProfileUtils.assertStringOrFail(poolName, 'ComposerProfiles.getComposerPoolOrFail.poolName');
  const pool = COMPOSER_PROFILE_POOLS[poolName];
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error(`ComposerProfiles.getComposerPoolOrFail: pool "${poolName}" is missing or empty`);
  }
  return composerProfileUtils.cloneComposerEntriesOrFail(pool, `getComposerPoolOrFail(${poolName})`);
};

getDefaultComposerPoolOrFail = () => getComposerPoolOrFail('default');
