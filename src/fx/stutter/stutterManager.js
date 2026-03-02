// fx/StutterManager.js - Audio effects manager

const SC = stutterConfig;
const V = validator.create('stutterManager');

class StutterManager {
  constructor() {
    // Channel tracking - one pool per effect type (no collision)
    this.lastUsedCHs = new Set();      // for stutterFade
    this.lastUsedCHs2 = new Set();     // for stutterPan
    this.lastUsedCHs3 = new Set();     // for stutterFX

    // Capture the naked globals (rely on require-side effects to define them)
    if (!stutterFade || !stutterPan || !stutterFX) {
      throw new Error('StutterManager: stutterFade/stutterPan/stutterFX implementations are required');
    }
    this._stutterFade = stutterFade;
    this._stutterPan = stutterPan;
    this._stutterFX = stutterFX;

    // Shared state for stutterNotes shift tracking - shared across manager usage
    this.shared = { shifts: new Map(), global: {} };

    // Beat-level context written by CC effects, read by stutterNotes for cooperation
    // { fadeDirection: 'in'|'out', fadeChannels: Set, panChannels: Set, panDirections: {} }
    this.beatContext = {};

    // Texture coupling state: updated by eventBus 'texture-contrast' listener (#1)
    this._textureIntensity = 0;
    this._lastTextureMode = 'single';
    this._textureDecay = 0.85;
    this._textureListenerAttached = false;

    // Plan scheduling: explicit plan objects (opt-in global stutter phrases)
    // plans: Map<planId, planCfg>
    this.plans = new Map();
    this.scheduledPlans = new Map(); // tickKey -> [planId,...]
    this._nextPlanId = 1;

    V.assertManagerShape(stutterPlanScheduler, 'stutterPlanScheduler', ['schedulePlan']);
    V.assertManagerShape(SC, 'stutterConfig', ['getConfig', 'getDirectiveDefaults']);
    this.config = SC.getConfig();
    V.assertObject(this.config, 'this.config');

    // Default directive applied each beat unless overridden (keeps features active by default)
    this.defaultDirective = SC.getDirectiveDefaults();
    V.assertObject(this.defaultDirective, 'this.defaultDirective');

    // fx loads before play/eventBus; listener is attached lazily from prepareBeat().
  }

  _attachTextureListener() {
    if (this._textureListenerAttached) return true;
    const EVENTS = V.getEventsOrThrow();
    const eventName = EVENTS.TEXTURE_CONTRAST;

    // -- Texture-contrast eventBus listener (#1 bidirectional dialogue) --
    // Chord bursts - trigger micro-stutters with tight rate + wide stereo phase
    // Flurries - suppress spontaneous stutters (let the runs breathe)
    eventBus.on(eventName, (data) => {
      const composite = Number(data.composite);
      const mode = data.mode;
      const weight = mode === 'chordBurst' ? 0.8 : mode === 'flurry' ? 0.3 : 0;
      this._textureIntensity = this._textureIntensity * this._textureDecay + weight * (1 - this._textureDecay);
      this._lastTextureMode = mode;

      // Chord burst - immediate micro-stutter response on reflection channels
      if (mode === 'chordBurst' && composite > 0.3) {
        V.assertArray(reflection, 'reflection');
        V.requireType(this._stutterPan, 'function', 'this._stutterPan');
        const reflChs = reflection.slice(0, 2);
        if (reflChs.length > 0) {
          const microRate = clamp(m.round(24 + composite * 16), 24, 48);
          const microDuration = tpUnit * rf(0.3, 0.6);
          this._stutterPan.call(this, reflChs, microRate, microDuration);
        }
      }
    });
    this._textureListenerAttached = true;
    return true;
  }

  /**
   * Update the default directive used for spontaneous stutters.
   * @param {Object} directive
   */
  setDefaultDirective(directive) {
    if (directive && typeof directive === 'object') {
      this.defaultDirective = Object.assign({}, this.defaultDirective, directive);
    }
    return this.defaultDirective;
  }

  _getStutterGrainParams() {
    const grain = conductorConfig.getStutterGrainParams();
    V.assertObject(grain, 'grain');
    return grain;
  }

  /**
   * Shared stutter invocation: resolves grain defaults, validates, calls impl.
   * @param {string} label - method name for error messages (e.g. 'stutterFade')
   * @param {Function} impl - bound implementation (this._stutterFade etc.)
   * @param {string} grainCountKey - grain param key for stutter count (e.g. 'fadeCount')
   * @param {string} grainDurationKey - grain param key for duration (e.g. 'fadeDuration')
   * @param {number[]} channels
   * @param {number|undefined} numStutters
   * @param {number|undefined} duration
   */
  _invokeStutter(label, impl, grainCountKey, grainDurationKey, channels, numStutters, duration) {
    const grain = this._getStutterGrainParams();
    const effectiveStutters = V.optionalFinite(Number(numStutters), ri(grain[grainCountKey][0], grain[grainCountKey][1]));
    const effectiveDuration = V.optionalFinite(Number(duration), tpSec * rf(grain[grainDurationKey][0], grain[grainDurationKey][1]));
    if (!channels || (Array.isArray(channels) && channels.length === 0)) {
      throw new Error(`StutterManager.${label}: called with no channels`);
    }
    if (effectiveStutters <= 0) throw new Error(`StutterManager.${label}: numStutters must be a positive number`);
    if (effectiveDuration <= 0) throw new Error(`StutterManager.${label}: duration must be positive`);
    V.requireType(impl, 'function', `${label} implementation`);
    return impl.call(this, channels, effectiveStutters, effectiveDuration);
  }

  stutterFade(channels, numStutters = undefined, duration = undefined) {
    return this._invokeStutter('stutterFade', this._stutterFade, 'fadeCount', 'fadeDuration', channels, numStutters, duration);
  }

  stutterPan(channels, numStutters = undefined, duration = undefined) {
    return this._invokeStutter('stutterPan', this._stutterPan, 'panCount', 'panDuration', channels, numStutters, duration);
  }

  stutterFX(channels, numStutters = undefined, duration = undefined) {
    return this._invokeStutter('stutterFX', this._stutterFX, 'fxCount', 'fxDuration', channels, numStutters, duration);
  }

  // -----------------------------
  // stutter plan API (explicit, opt-in)
  // -----------------------------
  /**
   * Create a reusable plan object and return its id (does not schedule it).
   * planCfg must include at least: profile, note, on, sustain. Optional: channels, numStutters, duration, minVelocity, maxVelocity, isFadeIn, decay
   */
  createPlan(planCfg = {}) {
    return stutterPlanScheduler.createPlan(this, planCfg);
  }

  /**
   * Schedule a plan (planCfg or existing plan id). If startTick is in the future it will be queued,
   * otherwise executed immediately. Returns the plan id.
   */
  schedulePlan(planOrCfg = {}) {
    return stutterPlanScheduler.schedulePlan(this, planOrCfg);
  }

  /**
   * Execute a plan immediately (id or cfg). Returns plan object.
   */
  runPlan(planIdOrCfg = {}) {
    return stutterPlanScheduler.runPlan(this, planIdOrCfg);
  }

  /**
   * Cancel a previously scheduled plan by id.
   */
  cancelPlan(planId) {
    return stutterPlanScheduler.cancelPlan(this, planId);
  }

  /**
   * Run any plans scheduled for the given tick (or earlier). Intended to be called from the beat loop.
   */
  runDuePlans(tick) {
    return stutterPlanScheduler.runDuePlans(this, tick);
  }

  /**
   * Internal: execute plan object by calling `stutterNotes` across the plan channels/ticks.
   */
  _executePlan(plan = {}) {
    return stutterPlanScheduler.executePlan(this, plan);
  }

  /**
   * Schedule stutter effects for a given unit-level note.
   * Passes beatContext so stutterNotes can cooperate with CC effects.
   * @param {any} opts
   * @returns {any} shared state from stutterNotes
   */
  scheduleStutterForUnit(opts = {}) {
    if (!stutterNotes) throw new Error('StutterManager.scheduleStutterForUnit: stutterNotes helper not available');
    const provided = Object.assign({}, opts);
    if (!provided.shared) provided.shared = this.shared;

    // merge default directive into unit-stutter opts when present (coherence only currently)
    provided.beatContext = this.beatContext;
    V.assertObject(provided.beatContext, 'provided.beatContext');
    if (!provided.beatContext.coherenceKey && this.defaultDirective && this.defaultDirective.coherence && this.defaultDirective.coherence.enabled) {
      const prefix = this.defaultDirective.coherence.keyPrefix || 'stutter';
      const seed = provided.coherenceGroup || provided.coherenceKey || 'unit';
      provided.beatContext.coherenceKey = `${prefix}:${seed}`;
    }

    stutterMetrics.incScheduled(1, provided.profile || 'unknown');
    return stutterNotes(provided);
  }

  prepareBeat() {
    this._attachTextureListener();
    // Idempotent per-beat setup: apply default directive (coherenceKey, reset per-beat selectors)
    if (!this.beatContext) this.beatContext = {};
    // Reset per-beat selection sets when beatIndex changes
    const currentBeatIndexLocal = beatIndex;
    if (this.beatContext._lastBeatIndex !== currentBeatIndexLocal) {
      this.beatContext._lastBeatIndex = currentBeatIndexLocal;
      this.beatContext.selectedReflectionChannels = new Set();
      this.beatContext.selectedBassChannels = new Set();

      // Texture coupling (#1): when recent flurry activity is high, suppress
      // stutter channel selection so flurry runs breathe without fragmentation
      const textureSuppression = (this._lastTextureMode === 'flurry' && this._textureIntensity > 0.15)
        ? clamp(1 - this._textureIntensity * 1.5, 0.1, 0.5) // lower selection chance
        : 0.5;

      V.assertArray(reflection, 'reflection');
      V.assertArray(bass, 'bass');
      const reflCandidates = reflection.slice();
      for (const ch of reflCandidates) if (this.beatContext.selectedReflectionChannels.size < 2 && rf() < textureSuppression) this.beatContext.selectedReflectionChannels.add(ch);
      const bassCandidates = bass.slice();
      for (const ch of bassCandidates) if (this.beatContext.selectedBassChannels.size < 2 && rf() < textureSuppression) this.beatContext.selectedBassChannels.add(ch);
    }

    // Apply default coherence key if enabled in defaultDirective
    const def = this.defaultDirective;
    V.assertObject(def, 'def');
    if (def.coherence && def.coherence.enabled) {
      const prefix = (def.coherence && typeof def.coherence.keyPrefix === 'string' && def.coherence.keyPrefix.length > 0) ? def.coherence.keyPrefix : 'stutter';
      const seed = `${m.round(V.requireFinite(measureIndex, 'measureIndex'))}:${m.round(V.requireFinite(beatIndex, 'beatIndex'))}`;
      this.beatContext.coherenceKey = `${prefix}:beat:${seed}`;
    } else if (this.beatContext && this.beatContext.coherenceKey && !(def.coherence && def.coherence.enabled)) {
      // clear if defaults say disabled and it was left over
      delete this.beatContext.coherenceKey;
    }

    // Ensure modulation bus exists for this beat
    if (!this.beatContext.mod) this.beatContext.mod = {};

    return this.beatContext;
  }

  /**
   * Reset channel tracking for the given channels or all.
   * @param {number[]|null} [channels]
   */
  resetChannelTracking(channels = null) {
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
}

// Export StutterManager instance and class to global namespace
stutter = new StutterManager();

// Delegator wrappers for runtime/tests (minimal and fail-fast).
stutterFade = (...args) => stutter.stutterFade(...args);
stutterPan = (...args) => stutter.stutterPan(...args);
stutterFX = (...args) => stutter.stutterFX(...args);
