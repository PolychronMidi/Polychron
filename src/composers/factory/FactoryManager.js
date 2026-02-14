FactoryManager = class FactoryManager {
  static sharedPhraseArcManager = null;
  static sharedComposerCtx = null;

  static capabilityProfiles = factoryProfiles.getCapabilityProfilesDefault();
  static runtimeProfilePrecedence = factoryProfiles.getRuntimeProfilePrecedenceDefault();
  static constructors = factoryConstructors.build(FactoryManager);

  static setComposerContext(ctx) {
    if (ctx && typeof ctx === 'object') {
      this.sharedComposerCtx = ctx;
    }
  }

  static getPhraseArcManager(opts = {}) {
    if (!this.sharedPhraseArcManager) {
      this.sharedPhraseArcManager = new PhraseArcManager(opts);
    }
    return this.sharedPhraseArcManager;
  }

  static resetPhraseArcManager() {
    if (this.sharedPhraseArcManager) {
      this.sharedPhraseArcManager.reset();
    }
  }

  static getCommonProfileConfigKeys() {
    return factoryProfiles.getCommonProfileConfigKeys();
  }

  static getConstructorOptionKeysByType() {
    return factoryProfiles.getConstructorOptionKeysByType();
  }

  static validateCapabilityProfiles() {
    this.capabilityProfiles = factoryProfiles.validateCapabilityProfiles(this.capabilityProfiles);
    return this.capabilityProfiles;
  }

  static validateProfileSchemaFactoryCompatibility() {
    return factoryProfiles.validateProfileSchemaFactoryCompatibility(this.getConstructorOptionKeysByType.bind(this));
  }

  static resolveRuntimeProfiles(config = {}) {
    return factoryProfiles.resolveRuntimeProfiles(config);
  }

  static applyRuntimeProfileConfig(composer, config = {}) {
    return factoryProfiles.applyRuntimeProfileConfig(composer, config, this.runtimeProfilePrecedence);
  }

  static applyCapabilityContract(composer, type, config = {}) {
    return factoryProfiles.applyCapabilityContract(composer, type, config, this.capabilityProfiles);
  }

  static normalizeProgressionKeyOrFail(key, label = 'ComposerFactory.normalizeProgressionKeyOrFail') {
    return factoryProgression.normalizeProgressionKeyOrFail(key, label);
  }

  static getRomanQualityOrFail(quality, label = 'ComposerFactory.getRomanQualityOrFail') {
    return factoryProgression.getRomanQualityOrFail(quality, label);
  }

  static hasDiatonicKeyData(key, quality = 'major') {
    return factoryProgression.hasDiatonicKeyData(key, quality);
  }

  static getProgressionKeyPoolOrFail(quality = 'major') {
    return factoryProgression.getProgressionKeyPoolOrFail(quality);
  }

  static resolveProgressionKeyOrFail(key, label = 'ComposerFactory.resolveProgressionKeyOrFail', quality = 'major') {
    return factoryProgression.resolveProgressionKeyOrFail(key, label, quality);
  }

  static create(config = {}, ctx = null) {
    if (config !== undefined && (typeof config !== 'object' || config === null)) {
      throw new Error('ComposerFactory.create: config must be an object if provided');
    }
    const type = config.type || 'scale';
    const constructorFn = this.constructors[type];
    if (!constructorFn) {
      throw new Error(`ComposerFactory.create: unknown composer type "${type}"—fail-fast`);
    }

    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);

    const composer = constructorFn(config);
    this.applyRuntimeProfileConfig(composer, config);
    return this.applyCapabilityContract(composer, type, config);
  }

  static resolveComposerPoolName(extraConfig = {}, composerCtx = null) {
    return factoryPoolResolver.resolveComposerPoolName(extraConfig, composerCtx);
  }

  static getComposerFamiliesOrFail() {
    return factoryFamilies.getComposerFamiliesOrFail(this.constructors);
  }

  static resolvePhraseFamilyOrFail(extraConfig = {}, composerCtx = null) {
    return factoryFamilies.resolvePhraseFamilyOrFail(extraConfig, composerCtx, this.sharedComposerCtx, this.constructors);
  }

  static inferComposerType(composerInstance) {
    return factoryFamilies.inferComposerType(composerInstance);
  }

  static scoreFamilyCandidateConfig(candidateConfig, opts = {}) {
    return factoryFamilies.scoreFamilyCandidateConfig(candidateConfig, opts);
  }

  static pickWeightedFamilyCandidateOrFail(candidateConfigs, opts = {}) {
    return factoryFamilies.pickWeightedFamilyCandidateOrFail(candidateConfigs, opts);
  }

  static createRandomForLayer(opts = {}, ctx = null) {
    if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
      throw new Error('ComposerFactory.createRandomForLayer: opts must be an object');
    }

    const familyName = opts.familyName;
    if (typeof familyName !== 'string' || familyName.length === 0) {
      throw new Error('ComposerFactory.createRandomForLayer: familyName must be a non-empty string');
    }
    const layerName = opts.layerName;
    if (typeof layerName !== 'string' || layerName.length === 0) {
      throw new Error('ComposerFactory.createRandomForLayer: layerName must be a non-empty string');
    }

    const extraConfig = (opts.extraConfig && typeof opts.extraConfig === 'object') ? opts.extraConfig : {};
    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);

    const families = this.getComposerFamiliesOrFail();
    const family = families[familyName];
    if (!family) {
      throw new Error(`ComposerFactory.createRandomForLayer: unknown family "${familyName}"`);
    }
    const allowedTypes = new Set(family.types);

    const poolName = this.resolveComposerPoolName(extraConfig, composerCtx);
    let composerPool;
    if (poolName === 'default') {
      if (typeof getDefaultComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandomForLayer: getDefaultComposerPoolOrFail() is not available');
      }
      composerPool = getDefaultComposerPoolOrFail();
    } else {
      if (typeof getComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandomForLayer: getComposerPoolOrFail() is not available');
      }
      composerPool = getComposerPoolOrFail(poolName);
    }

    const familyPool = composerPool.filter((cfg) => cfg && typeof cfg.type === 'string' && allowedTypes.has(cfg.type));
    if (familyPool.length === 0) {
      throw new Error(`ComposerFactory.createRandomForLayer: no composer profiles in pool "${poolName}" for family "${familyName}"`);
    }

    const maxAttempts = m.min(12, familyPool.length * 2);
    let lastError = null;

    for (let i = 0; i < maxAttempts; i++) {
      const cfg = this.pickWeightedFamilyCandidateOrFail(familyPool, {
        previousComposer: opts.previousComposer,
        peerComposer: opts.peerComposer,
        layerName
      });

      try {
        const composer = this.create(Object.assign({}, cfg, extraConfig), composerCtx);
        if (typeof composer.getNotes !== 'function') {
          throw new Error('created composer missing getNotes() method');
        }
        const notes = composer.getNotes();
        if (!Array.isArray(notes) || notes.length === 0) {
          throw new Error('composer.getNotes() returned empty or invalid array');
        }

        composer._factoryType = cfg.type;
        composer._profileFamily = familyName;
        composer._profilePool = poolName;
        composer._layerTarget = layerName;
        return composer;
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error(`ComposerFactory.createRandomForLayer: failed for layer "${layerName}" in family "${familyName}" after ${maxAttempts} attempts. Last error: ${lastError && lastError.message ? lastError.message : lastError}`);
  }

  static createRandom(extraConfig = {}, ctx = null) {
    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);

    const poolName = this.resolveComposerPoolName(extraConfig, composerCtx);
    let composerPool;
    if (poolName === 'default') {
      if (typeof getDefaultComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandom: getDefaultComposerPoolOrFail() is not available');
      }
      composerPool = getDefaultComposerPoolOrFail();
    } else {
      if (typeof getComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandom: getComposerPoolOrFail() is not available');
      }
      composerPool = getComposerPoolOrFail(poolName);
    }
    if (!Array.isArray(composerPool) || composerPool.length === 0) {
      throw new Error(`ComposerFactory.createRandom: composer profile pool "${poolName}" is empty`);
    }

    const maxAttempts = m.min(8, composerPool.length);
    let lastError = null;

    for (let i = 0; i < maxAttempts; i++) {
      const cfg = composerPool[ri(composerPool.length - 1)];
      try {
        const composer = this.create(Object.assign({}, cfg, extraConfig), composerCtx);
        if (typeof composer.getNotes !== 'function') {
          throw new Error('ComposerFactory.createRandom: created composer missing getNotes() method');
        }
        const notes = composer.getNotes();
        if (!Array.isArray(notes) || notes.length === 0) {
          throw new Error('ComposerFactory.createRandom: composer.getNotes() returned empty or invalid array');
        }
        return composer;
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error(`ComposerFactory.createRandom: failed to create valid composer after ${maxAttempts} attempts from pool "${poolName}". Last error: ${lastError && lastError.message ? lastError.message : lastError}`);
  }
};

FactoryManager.validateCapabilityProfiles();
FactoryManager.validateProfileSchemaFactoryCompatibility();
ComposerFactory = FactoryManager;
