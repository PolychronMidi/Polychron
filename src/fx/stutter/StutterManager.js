// fx/StutterManager.js - Audio effects manager

const SC = stutterConfig;
const V = validator.create('StutterManager');
const stutterFadeImpl = stutterFade;
const stutterPanImpl = stutterPan;
const stutterFXImpl = stutterFX;

V.requireType(stutterFadeImpl, 'function', 'stutterFade');
V.requireType(stutterPanImpl, 'function', 'stutterPan');
V.requireType(stutterFXImpl, 'function', 'stutterFX');
V.assertManagerShape(stutterPlanScheduler, 'stutterPlanScheduler', ['schedulePlan']);
V.assertManagerShape(SC, 'stutterConfig', ['getConfig', 'getDirectiveDefaults']);

const config = SC.getConfig();
V.assertObject(config, 'config');

const defaultDirective = SC.getDirectiveDefaults();
V.assertObject(defaultDirective, 'defaultDirective');

StutterManager = class StutterManager {
  static shared;
  static beatContext;
  static plans;
  static scheduledPlans;
  static config;
  static defaultDirective;
  static lastUsedCHs;
  static lastUsedCHs2;
  static lastUsedCHs3;
  static StutterManagerNextPlanId;
  static StutterManagerStutterFade;
  static StutterManagerStutterPan;
  static StutterManagerStutterFX;
  static StutterManagerTextureIntensity;
  static StutterManagerLastTextureMode;
  static StutterManagerTextureDecay;
  static StutterManagerTextureListenerAttached;

  static StutterManagerAttachTextureListener() {
    if (this.StutterManagerTextureListenerAttached) return true;
    const EVENTS = V.getEventsOrThrow();
    const eventName = EVENTS.TEXTURE_CONTRAST;

    eventBus.on(eventName, (data) => {
      const composite = Number(data.composite);
      const mode = data.mode;
      const weight = mode === 'chordBurst' ? 0.8 : mode === 'flurry' ? 0.3 : 0;
      this.StutterManagerTextureIntensity = this.StutterManagerTextureIntensity * this.StutterManagerTextureDecay + weight * (1 - this.StutterManagerTextureDecay);
      this.StutterManagerLastTextureMode = mode;

      if (mode === 'chordBurst' && composite > 0.3) {
        V.assertArray(reflection, 'reflection');
        const reflChs = reflection.slice(0, 2);
        if (reflChs.length > 0) {
          const microRate = clamp(m.round(24 + composite * 16), 24, 48);
          const microDuration = spUnit * rf(0.3, 0.6);
          this.StutterManagerStutterPan.call(this, reflChs, microRate, microDuration);
        }
      }
    });

    this.StutterManagerTextureListenerAttached = true;
    return true;
  }

  static setDefaultDirective(directive) {
    if (directive && typeof directive === 'object') {
      this.defaultDirective = Object.assign({}, this.defaultDirective, directive);
    }
    return this.defaultDirective;
  }

  static StutterManagerGetStutterGrainParams() {
    const grain = conductorConfig.getStutterGrainParams();
    V.assertObject(grain, 'grain');
    return grain;
  }

  /**
   * Shared stutter invocation: resolves grain defaults, validates, calls impl.
   * @param {string} label
   * @param {Function} impl
   * @param {string} grainCountKey
   * @param {string} grainDurationKey
   * @param {number[]} channels
   * @param {number|undefined} numStutters
   * @param {number|undefined} duration
   */
  static StutterManagerInvokeStutter(label, impl, grainCountKey, grainDurationKey, channels, numStutters, duration) {
    const grain = this.StutterManagerGetStutterGrainParams();
    const effectiveStutters = V.optionalFinite(Number(numStutters), ri(grain[grainCountKey][0], grain[grainCountKey][1]));
    const effectiveDuration = V.optionalFinite(Number(duration), spBeat * rf(grain[grainDurationKey][0], grain[grainDurationKey][1]));
    if (!channels || (Array.isArray(channels) && channels.length === 0)) {
      throw new Error(`StutterManager.${label}: called with no channels`);
    }
    if (effectiveStutters <= 0) throw new Error(`StutterManager.${label}: numStutters must be a positive number`);
    if (effectiveDuration <= 0) throw new Error(`StutterManager.${label}: duration must be positive`);
    V.requireType(impl, 'function', `${label} implementation`);
    return impl.call(this, channels, effectiveStutters, effectiveDuration);
  }

  static stutterFade(channels, numStutters = undefined, duration = undefined) {
    return this.StutterManagerInvokeStutter('stutterFade', this.StutterManagerStutterFade, 'fadeCount', 'fadeDuration', channels, numStutters, duration);
  }

  static stutterPan(channels, numStutters = undefined, duration = undefined) {
    return this.StutterManagerInvokeStutter('stutterPan', this.StutterManagerStutterPan, 'panCount', 'panDuration', channels, numStutters, duration);
  }

  static stutterFX(channels, numStutters = undefined, duration = undefined) {
    return this.StutterManagerInvokeStutter('stutterFX', this.StutterManagerStutterFX, 'fxCount', 'fxDuration', channels, numStutters, duration);
  }

  static createPlan(planCfg = {}) {
    return stutterPlanScheduler.createPlan(this, planCfg);
  }

  static schedulePlan(planOrCfg = {}) {
    return stutterPlanScheduler.schedulePlan(this, planOrCfg);
  }

  static runPlan(planIdOrCfg = {}) {
    return stutterPlanScheduler.runPlan(this, planIdOrCfg);
  }

  static cancelPlan(planId) {
    return stutterPlanScheduler.cancelPlan(this, planId);
  }

  static runDuePlans(absoluteSeconds) {
    return stutterPlanScheduler.runDuePlans(this, absoluteSeconds);
  }

  static StutterManagerExecutePlan(plan = {}) {
    return stutterPlanScheduler.executePlan(this, plan);
  }

  /**
   * Schedule stutter effects for a given unit-level note.
   * Passes beatContext so stutterNotes can cooperate with CC effects.
   * @param {any} opts
   * @returns {any} shared state from stutterNotes
   */
  static scheduleStutterForUnit(opts = {}) {
    if (!stutterNotes) throw new Error('StutterManager.scheduleStutterForUnit: stutterNotes helper not available');

    const provided = /** @type {any} */ (Object.assign({}, opts));
    if (!provided.shared) provided.shared = this.shared;

    provided.beatContext = this.beatContext;
    V.assertObject(provided.beatContext, 'provided.beatContext');
    if (!provided.beatContext.coherenceKey && this.defaultDirective && this.defaultDirective.coherence && this.defaultDirective.coherence.enabled) {
      const prefix = this.defaultDirective.coherence.keyPrefix || 'stutter';
      const seed = provided.coherenceGroup || provided.coherenceKey || 'unit';
      provided.beatContext.coherenceKey = `${prefix}:${seed}`;
    }

    if (stutterVariants.shouldThrottle()) return provided.shared || this.shared;
    stutterVariants.incSectionCount();
    V.assertNonEmptyString(provided.profile, 'provided.profile');
    stutterMetrics.incScheduled(1, provided.profile);
    const variant = stutterVariants.getActive();
    const variantName = stutterVariants.getActiveName();
    stutterMetrics.incVariant(variantName);
    const helper = variant || stutterRegistry.getHelper();
    const result = (helper || stutterNotes)(provided);
    // Consolidated STUTTER_APPLIED event - one per invocation, not per step.
    // Prevents dense variants from causing disproportionate feedback accumulation.
    const eventName = eventCatalog.names.STUTTER_APPLIED;
    eventBus.emit(eventName, {
      type: 'note',
      variant: variantName || 'default',
      profile: provided.profile,
      channel: provided.channel,
      intensity: clamp(V.requireFinite(provided.velocity, 'provided.velocity') / MIDI_MAX_VALUE, 0, 1),
      timeInSeconds: V.requireFinite(provided.on, 'provided.on')
    });
    // R24: multi-variant beat - 20% chance of a second variant on a mirror channel
    if (rf() < 0.2 && this.beatContext && this.beatContext.selectedReflectionChannels) {
      const mirrorChs = Array.from(this.beatContext.selectedReflectionChannels);
      if (mirrorChs.length > 0) {
        const secondVariant = stutterVariants.getVariant('ghostStutter');
        if (secondVariant) {
          const mirrorCh = mirrorChs[ri(mirrorChs.length - 1)];
          secondVariant(Object.assign({}, provided, {
            channel: mirrorCh, profile: 'reflection',
            velocity: clamp(m.round(provided.velocity * 0.5), 1, MIDI_MAX_VALUE),
            binVel: clamp(m.round(provided.velocity * 0.5), 1, MIDI_MAX_VALUE)
          }));
        }
      }
    }
    return result;
  }

  static prepareBeat(beatStartTime) {
    void beatStartTime;
    this.StutterManagerAttachTextureListener();
    stutterVariants.selectForBeat();
    // Stereo width oscillation for stereoWidthModulation variant
    if (!this.beatContext) this.beatContext = {};
    const swt = beatStartTime * 0.25;
    this.beatContext.stereoWidth = 0.6 + m.sin(swt * m.PI * 2) * 0.3;
    if (!this.beatContext) this.beatContext = {};

    const beatContext = this.beatContext;
    const currentBeatIndexLocal = beatIndex;
    if (beatContext.StutterManagerLastBeatIndex !== currentBeatIndexLocal) {
      beatContext.StutterManagerLastBeatIndex = currentBeatIndexLocal;
      beatContext.selectedReflectionChannels = new Set();
      beatContext.selectedBassChannels = new Set();

      const textureSuppression = (this.StutterManagerLastTextureMode === 'flurry' && this.StutterManagerTextureIntensity > 0.15)
        ? clamp(1 - this.StutterManagerTextureIntensity * 1.5, 0.1, 0.5)
        : 0.5;

      V.assertArray(reflection, 'reflection');
      V.assertArray(bass, 'bass');
      // CIM: coordinated = more channels stutter together, independent = fewer
      const cimCoord = /** @type {number} */ (this.StutterManagerChannelCoordination) || 0.5;
      const cimMaxChannels = m.max(1, m.round(2 + (cimCoord - 0.5) * 3));
      const cimProb = textureSuppression * (0.5 + cimCoord * 0.5);
      selectMirrorChannels(beatContext.selectedReflectionChannels, reflection, cimMaxChannels, cimProb);
      selectMirrorChannels(beatContext.selectedBassChannels, bass, cimMaxChannels, cimProb);
    }

    const def = /** @type {any} */ (this.defaultDirective);
    V.assertObject(def, 'def');
    if (def.coherence && def.coherence.enabled) {
      const prefix = (def.coherence && typeof def.coherence.keyPrefix === 'string' && def.coherence.keyPrefix.length > 0) ? def.coherence.keyPrefix : 'stutter';
      const seed = `${m.round(V.requireFinite(measureIndex, 'measureIndex'))}:${m.round(V.requireFinite(beatIndex, 'beatIndex'))}`;
      beatContext.coherenceKey = `${prefix}:beat:${seed}`;
    } else if (beatContext.coherenceKey) {
      delete beatContext.coherenceKey;
    }

    if (!beatContext.mod) beatContext.mod = {};
    return beatContext;
  }

  static setChannelCoordinationScale(scale) {
    this.StutterManagerChannelCoordination = clamp(scale, 0, 1);
  }

  /**
   * Reset channel tracking for the given channels or all.
   * @param {number[]|null} [channels]
   */
  static resetChannelTracking(channels = null) {
    if (Array.isArray(channels) && channels.length > 0) {
      for (const ch of /** @type {number[]} */ (channels)) {
        this.lastUsedCHs.delete(ch);
        this.lastUsedCHs2.delete(ch);
        this.lastUsedCHs3.delete(ch);
      }
      return { cleared: /** @type {number} */ (channels.length) };
    }

    const prev1 = this.lastUsedCHs.size;
    const prev2 = this.lastUsedCHs2.size;
    const prev3 = this.lastUsedCHs3.size;
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();
    this.lastUsedCHs3.clear();
    this.beatContext = {};
    this.shared.shifts.clear();
    this.shared.global = {};

    return { cleared: prev1 + prev2 + prev3, lastUsedCHs: prev1, lastUsedCHs2: prev2, lastUsedCHs3: prev3 };
  }
};

const stutterManagerStatic = /** @type {any} */ (StutterManager);
stutterManagerStatic.lastUsedCHs = new Set();
stutterManagerStatic.lastUsedCHs2 = new Set();
stutterManagerStatic.lastUsedCHs3 = new Set();
stutterManagerStatic.shared = { shifts: new Map(), global: {} };
stutterManagerStatic.beatContext = {};
stutterManagerStatic.plans = new Map();
stutterManagerStatic.scheduledPlans = new Map();
stutterManagerStatic.config = config;
stutterManagerStatic.defaultDirective = defaultDirective;
stutterManagerStatic.StutterManagerNextPlanId = 1;
stutterManagerStatic.StutterManagerStutterFade = stutterFadeImpl;
stutterManagerStatic.StutterManagerStutterPan = stutterPanImpl;
stutterManagerStatic.StutterManagerStutterFX = stutterFXImpl;
stutterManagerStatic.StutterManagerTextureIntensity = 0;
stutterManagerStatic.StutterManagerLastTextureMode = 'single';
stutterManagerStatic.StutterManagerTextureDecay = 0.85;
stutterManagerStatic.StutterManagerTextureListenerAttached = false;
stutterManagerStatic.StutterManagerChannelCoordination = 0.5;

stutterFade = (...args) => StutterManager.stutterFade(...args);
stutterPan = (...args) => StutterManager.stutterPan(...args);
stutterFX = (...args) => StutterManager.stutterFX(...args);
