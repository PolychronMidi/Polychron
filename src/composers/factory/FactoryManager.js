const V = validator.create('FactoryManager');
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
    V.assertObject(ctx, 'ctx');
    this.sharedComposerCtx = ctx;
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

  static normalizeProgressionKeyOrFail(key, label = 'FactoryManager.normalizeProgressionKeyOrFail') {
    return factoryProgression.normalizeProgressionKeyOrFail(key, label);
  }

  static getRomanQualityOrFail(quality, label = 'FactoryManager.getRomanQualityOrFail') {
    return factoryProgression.getRomanQualityOrFail(quality, label);
  }

  static hasDiatonicKeyData(key, quality = 'major') {
    return factoryProgression.hasDiatonicKeyData(key, quality);
  }

  static getProgressionKeyPoolOrFail(quality = 'major') {
    return factoryProgression.getProgressionKeyPoolOrFail(quality);
  }

  static resolveProgressionKeyOrFail(key, label = 'FactoryManager.resolveProgressionKeyOrFail', quality = 'major') {
    return factoryProgression.resolveProgressionKeyOrFail(key, label, quality);
  }

  /**
   * @param {Object} [config]
   * @param {Object} [ctx]
   */
  static create(config = {}, ctx = null) {
    V.assertPlainObject(config, 'config');
    const type = /** @type {any} */ (config).type || 'scale';
    const constructorFn = this.constructors[type];
    if (!constructorFn) {
      throw new Error(`FactoryManager.create: unknown composer type "${type}"-fail-fast`);
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
    if (this.activeFamily) {
      V.assertNonEmptyString(this.activeFamily, 'this.activeFamily');
      return this.activeFamily;
    }
    if (!LM) {
      throw new Error('FactoryManager.getActiveFamily: LayerManager is required when no active family is cached');
    }
    V.requireType(LM.getPhraseFamily, 'function', 'LM.getPhraseFamily');
    const family = LM.getPhraseFamily();
    V.assertNonEmptyString(family, 'family');
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
    if (opts !== undefined) V.assertObject(opts, 'opts');

    const familyName = /** @type {any} */ (opts).familyName;
    V.assertNonEmptyString(familyName, 'familyName');
    const layerName = /** @type {any} */ (opts).layerName;
    V.assertNonEmptyString(layerName, 'layerName');

    let extraConfig = /** @type {any} */ (opts).extraConfig;
    if (extraConfig !== undefined) V.assertObject(extraConfig, 'extraConfig');
    else extraConfig = {};
    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);

    const families = this.getComposerFamiliesOrFail();
    const family = families[familyName];
    if (!family) {
      throw new Error(`FactoryManager.createRandomForLayer: unknown family "${familyName}"`);
    }
    const allowedTypes = new Set(family.types);

    const poolName = this.resolveComposerPoolName(extraConfig, composerCtx);
    let composerPool;
    if (poolName === 'default') {
      if (!getDefaultComposerPoolOrFail) {
        throw new Error('FactoryManager.createRandomForLayer: getDefaultComposerPoolOrFail() is not available');
      }
      V.requireType(getDefaultComposerPoolOrFail, 'function', 'getDefaultComposerPoolOrFail');
      composerPool = getDefaultComposerPoolOrFail();
    } else {
      if (!getComposerPoolOrFail) {
        throw new Error('FactoryManager.createRandomForLayer: getComposerPoolOrFail() is not available');
      }
      V.requireType(getComposerPoolOrFail, 'function', 'getComposerPoolOrFail');
      composerPool = getComposerPoolOrFail(poolName);
    }

    const familyPool = composerPool.filter((cfg) => cfg && cfg.type && allowedTypes.has(cfg.type));
    if (familyPool.length === 0) {
      throw new Error(`FactoryManager.createRandomForLayer: no composer profiles in pool "${poolName}" for family "${familyName}"`);
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
        V.requireType(composer.getNotes, 'function', 'composer.getNotes');
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

    throw new Error(`FactoryManager.createRandomForLayer: failed for layer "${layerName}" in family "${familyName}" after ${maxAttempts} attempts. Last error: ${lastError && lastError.message ? lastError.message : lastError}`);
  }

};

FactoryManager.validateCapabilityProfiles();
FactoryManager.validateProfileSchemaFactoryCompatibility();
