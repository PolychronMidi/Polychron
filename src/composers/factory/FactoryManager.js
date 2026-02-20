const _fmV = Validator.create('FactoryManager');
FactoryManager = class FactoryManager {
  /** @type {any|null} */
  static sharedPhraseArcManager = null;
  /** @type {Object<string, any>|null} */
  static sharedComposerCtx = null;
  /** @type {string|null} */
  static activeFamily = null;

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

  /**
   * @param {Object} [config]
   * @param {Object} [ctx]
   */
  static create(config = {}, ctx = null) {
    _fmV.assertPlainObject(config, 'config');
    const type = /** @type {any} */ (config).type || 'scale';
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

  /**
   * @param {Object} [extraConfig]
   * @param {Object} [composerCtx]
   */
  static resolvePhraseFamilyOrFail(extraConfig = {}, composerCtx = null) {
    const family = factoryFamilies.resolvePhraseFamilyOrFail(extraConfig, composerCtx, this.sharedComposerCtx, this.constructors);
    this.activeFamily = family;
    return family;
  }

  static getActiveFamily() {
    if (typeof this.activeFamily === 'string' && this.activeFamily.length > 0) {
      return this.activeFamily;
    }
    if (typeof LM === 'undefined' || !LM || typeof LM.getPhraseFamily !== 'function') {
      throw new Error('ComposerFactory.getActiveFamily: LayerManager.getPhraseFamily is required when no active family is cached');
    }
    const family = LM.getPhraseFamily();
    if (typeof family !== 'string' || family.length === 0) {
      throw new Error('ComposerFactory.getActiveFamily: resolved family must be a non-empty string');
    }
    this.activeFamily = family;
    return family;
  }

  static inferComposerType(composerInstance) {
    return factoryFamilies.inferComposerType(composerInstance);
  }

  static scoreFamilyCandidateConfig(candidateConfig, opts = {}) {
    return factoryFamilies.scoreFamilyCandidateConfig(candidateConfig, opts);
  }

  /** @param {any} [opts] */
  static pickWeightedFamilyCandidateOrFail(candidateConfigs, opts = {}) {
    return factoryFamilies.pickWeightedFamilyCandidateOrFail(candidateConfigs, opts);
  }

  /**
   * @param {{familyName?: string, layerName?: string, extraConfig?: Object, previousComposer?: Object, peerComposer?: Object}} [opts]
   * @param {Object} [ctx]
   */
  static createRandomForLayer(opts = {}, ctx = null) {
    if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
      throw new Error('ComposerFactory.createRandomForLayer: opts must be an object');
    }

    const familyName = /** @type {any} */ (opts).familyName;
    if (typeof familyName !== 'string' || familyName.length === 0) {
      throw new Error('ComposerFactory.createRandomForLayer: familyName must be a non-empty string');
    }
    const layerName = /** @type {any} */ (opts).layerName;
    if (typeof layerName !== 'string' || layerName.length === 0) {
      throw new Error('ComposerFactory.createRandomForLayer: layerName must be a non-empty string');
    }

    const extraConfig = (/** @type {any} */ (opts).extraConfig && typeof /** @type {any} */ (opts).extraConfig === 'object') ? /** @type {any} */ (opts).extraConfig : {};
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
      const pickOpts = /** @type {{previousComposer?: any, peerComposer?: any, layerName?: string}} */ ({
        previousComposer: /** @type {any} */ (opts).previousComposer,
        peerComposer: /** @type {any} */ (opts).peerComposer,
        layerName
      });
      const cfg = this.pickWeightedFamilyCandidateOrFail(familyPool, pickOpts);

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

};

FactoryManager.validateCapabilityProfiles();
FactoryManager.validateProfileSchemaFactoryCompatibility();
ComposerFactory = FactoryManager;
