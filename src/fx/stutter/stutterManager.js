// fx/StutterManager.js - Audio effects manager

const SC = (typeof StutterConfig !== 'undefined') ? StutterConfig : null;
V = Validator.create('StutterManager');

class StutterManager {
  constructor() {
    // Channel tracking — one pool per effect type (no collision)
    this.lastUsedCHs = new Set();      // for stutterFade
    this.lastUsedCHs2 = new Set();     // for stutterPan
    this.lastUsedCHs3 = new Set();     // for stutterFX

    // Capture the naked globals (rely on require-side effects to define them)
    this._stutterFade = (typeof stutterFade === 'function') ? stutterFade : null;
    this._stutterPan = (typeof stutterPan === 'function') ? stutterPan : null;
    this._stutterFX = (typeof stutterFX === 'function') ? stutterFX : null;

    // Shared state for stutterNotes shift tracking — shared across manager usage
    this.shared = { shifts: new Map(), global: {} };

    // Beat-level context written by CC effects, read by stutterNotes for cooperation
    // { fadeDirection: 'in'|'out', fadeChannels: Set, panChannels: Set, panDirections: {} }
    this.beatContext = {};

    // Texture coupling state: updated by EventBus 'texture-contrast' listener (#1)
    this._textureIntensity = 0;
    this._lastTextureMode = 'single';
    this._textureDecay = 0.85;
    this._textureListenerAttached = false;

    // Plan scheduling: explicit plan objects (opt-in global stutter phrases)
    // plans: Map<planId, planCfg>
    this.plans = new Map();
    this.scheduledPlans = new Map(); // tickKey -> [planId,...]
    this._nextPlanId = 1;

    if (!SC || typeof SC.getConfig !== 'function') {
      throw new Error('StutterManager: StutterConfig.getConfig is not available');
    }
    this.config = SC.getConfig();
    if (!this.config || typeof this.config !== 'object') {
      throw new Error('StutterManager: StutterConfig.getConfig returned invalid config');
    }

    // Default directive applied each beat unless overridden (keeps features active by default)
    if (!SC || typeof SC.getDirectiveDefaults !== 'function') {
      throw new Error('StutterManager: StutterConfig.getDirectiveDefaults is not available');
    }
    this.defaultDirective = SC.getDirectiveDefaults();
    if (!this.defaultDirective || typeof this.defaultDirective !== 'object') {
      throw new Error('StutterManager: invalid default directive from StutterConfig.getDirectiveDefaults');
    }

    // fx loads before play/EventBus; listener is attached lazily from prepareBeat().
  }

  _attachTextureListener() {
    if (this._textureListenerAttached) return true;
    const EVENTS = V.getEventsOrThrow();
    const eventName = EVENTS.TEXTURE_CONTRAST;

    // ── Texture-contrast EventBus listener (#1 bidirectional dialogue) ──
    // Chord bursts → trigger micro-stutters with tight rate + wide stereo phase
    // Flurries → suppress spontaneous stutters (let the runs breathe)
    EventBus.on(eventName, (data) => {
      const composite = Number(data.composite);
      const mode = data.mode;
      const weight = mode === 'chordBurst' ? 0.8 : mode === 'flurry' ? 0.3 : 0;
      this._textureIntensity = this._textureIntensity * this._textureDecay + weight * (1 - this._textureDecay);
      this._lastTextureMode = mode;

      // Chord burst → immediate micro-stutter response on reflection channels
      if (mode === 'chordBurst' && composite > 0.3) {
        if (typeof reflection === 'undefined' || !Array.isArray(reflection)) {
          throw new Error('StutterManager._attachTextureListener: reflection channels array is not available');
        }
        if (typeof this._stutterPan !== 'function') {
          throw new Error('StutterManager._attachTextureListener: stutterPan implementation not available');
        }
        const reflChs = reflection.slice(0, 2);
        if (reflChs.length > 0) {
          const microRate = clamp(m.round(24 + composite * 16), 24, 48);
          const microDuration = (typeof tpUnit === 'number' && Number.isFinite(tpUnit)) ? tpUnit * rf(0.3, 0.6) : 100;
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
    const grain = ConductorConfig.getStutterGrainParams();
    if (!grain || typeof grain !== 'object') {
      throw new Error('StutterManager._getStutterGrainParams: invalid grain params');
    }
    return grain;
  }

  stutterFade(channels, numStutters = undefined, duration = undefined) {
    const grain = this._getStutterGrainParams();
    const effectiveStutters = Number.isFinite(Number(numStutters)) ? Number(numStutters) : ri(grain.fadeCount[0], grain.fadeCount[1]);
    const effectiveDuration = Number.isFinite(Number(duration)) ? Number(duration) : tpSec * rf(grain.fadeDuration[0], grain.fadeDuration[1]);
    if (!channels || (Array.isArray(channels) && channels.length === 0)) throw new Error('StutterManager.stutterFade: called with no channels');
    if (!Number.isFinite(effectiveStutters) || effectiveStutters <= 0) throw new Error('StutterManager.stutterFade: numStutters must be a positive number');
    if (!Number.isFinite(effectiveDuration) || effectiveDuration <= 0) throw new Error('StutterManager.stutterFade: duration must be positive');
    if (typeof this._stutterFade !== 'function') throw new Error('StutterManager.stutterFade: implementation not available');
    return this._stutterFade.call(this, channels, effectiveStutters, effectiveDuration);
  }

  stutterPan(channels, numStutters = undefined, duration = undefined) {
    const grain = this._getStutterGrainParams();
    const effectiveStutters = Number.isFinite(Number(numStutters)) ? Number(numStutters) : ri(grain.panCount[0], grain.panCount[1]);
    const effectiveDuration = Number.isFinite(Number(duration)) ? Number(duration) : tpSec * rf(grain.panDuration[0], grain.panDuration[1]);
    if (!channels || (Array.isArray(channels) && channels.length === 0)) throw new Error('StutterManager.stutterPan: called with no channels');
    if (!Number.isFinite(effectiveStutters) || effectiveStutters <= 0) throw new Error('StutterManager.stutterPan: numStutters must be a positive number');
    if (!Number.isFinite(effectiveDuration) || effectiveDuration <= 0) throw new Error('StutterManager.stutterPan: duration must be positive');
    if (typeof this._stutterPan !== 'function') throw new Error('StutterManager.stutterPan: implementation not available');
    return this._stutterPan.call(this, channels, effectiveStutters, effectiveDuration);
  }

  stutterFX(channels, numStutters = undefined, duration = undefined) {
    const grain = this._getStutterGrainParams();
    const effectiveStutters = Number.isFinite(Number(numStutters)) ? Number(numStutters) : ri(grain.fxCount[0], grain.fxCount[1]);
    const effectiveDuration = Number.isFinite(Number(duration)) ? Number(duration) : tpSec * rf(grain.fxDuration[0], grain.fxDuration[1]);
    if (!channels || (Array.isArray(channels) && channels.length === 0)) throw new Error('StutterManager.stutterFX: called with no channels');
    if (!Number.isFinite(effectiveStutters) || effectiveStutters <= 0) throw new Error('StutterManager.stutterFX: numStutters must be a positive number');
    if (!Number.isFinite(effectiveDuration) || effectiveDuration <= 0) throw new Error('StutterManager.stutterFX: duration must be positive');
    if (typeof this._stutterFX !== 'function') throw new Error('StutterManager.stutterFX: implementation not available');
    return this._stutterFX.call(this, channels, effectiveStutters, effectiveDuration);
  }

  // -----------------------------
  // Stutter plan API (explicit, opt-in)
  // -----------------------------
  /**
   * Create a reusable plan object and return its id (does not schedule it).
   * planCfg must include at least: profile, note, on, sustain. Optional: channels, numStutters, duration, minVelocity, maxVelocity, isFadeIn, decay
   */
  createPlan(planCfg = {}) {
    const id = `plan-${this._nextPlanId++}`;
    const cfg = /** @type {any} */ (Object.assign({}, planCfg));
    cfg.id = id;
    this.plans.set(id, cfg);
    return id;
  }

  /**
   * Schedule a plan (planCfg or existing plan id). If startTick is in the future it will be queued,
   * otherwise executed immediately. Returns the plan id.
   */
  schedulePlan(planOrCfg = {}) {
    const isId = (typeof planOrCfg === 'string' && this.plans.has(planOrCfg));
    const planId = isId ? planOrCfg : this.createPlan(planOrCfg || {});
    const plan = /** @type {any} */ (this.plans.get(planId));

    // Use provided startTick or fall back to plan.on or current beatStart
    const startTick = Number.isFinite(Number(plan.startTick))
      ? Number(plan.startTick)
      : (Number.isFinite(Number(plan.on)) ? Number(plan.on) : (typeof beatStart !== 'undefined' ? Number(beatStart) : 0));

    // queue for future tick, otherwise run now
    const key = m.round(startTick);
    if (key > m.round(typeof beatStart !== 'undefined' ? beatStart : 0)) {
      const arr = this.scheduledPlans.get(key) || [];
      arr.push(planId);
      this.scheduledPlans.set(key, arr);
      StutterMetrics.incScheduled(1, plan.profile || 'unknown');
      StutterMetrics.incPendingForTick(key, 1);
      return planId;
    }

    // immediate run
    this.runPlan(planId);
    return planId;
  }

  /**
   * Execute a plan immediately (id or cfg). Returns plan object.
   */
  runPlan(planIdOrCfg = {}) {
    const plan = /** @type {any} */ ((typeof planIdOrCfg === 'string') ? this.plans.get(planIdOrCfg) : planIdOrCfg);
    if (!plan || typeof plan !== 'object') throw new Error('StutterManager.runPlan: invalid plan');
    return this._executePlan(plan);
  }

  /**
   * Cancel a previously scheduled plan by id.
   */
  cancelPlan(planId) {
    if (!this.plans.has(planId)) return false;
    this.plans.delete(planId);
    for (const [tick, arr] of Array.from(this.scheduledPlans.entries())) {
      const filtered = arr.filter(id => id !== planId);
      if (filtered.length === 0) this.scheduledPlans.delete(tick); else this.scheduledPlans.set(tick, filtered);
    }
    return true;
  }

  /**
   * Run any plans scheduled for the given tick (or earlier). Intended to be called from the beat loop.
   */
  runDuePlans(tick) {
    const key = m.round(Number(tick));
    const dueKeys = Array.from(this.scheduledPlans.keys()).filter(k => k <= key).sort((a,b) => a-b);
    for (const k of dueKeys) {
      const arr = this.scheduledPlans.get(k) || [];
      for (const planId of arr) {
        const plan = this.plans.get(planId);
        if (plan) {
          StutterMetrics.decPendingForTick(k, 1);
          this._executePlan(plan);
        }
      }
      this.scheduledPlans.delete(k);
    }
    return true;
  }

  /**
   * Internal: execute plan object by calling `stutterNotes` across the plan channels/ticks.
   */
  _executePlan(plan = {}) {
    if (typeof stutterExecutePlan !== 'function') {
      throw new Error('StutterManager._executePlan: stutterExecutePlan helper not available');
    }
    return stutterExecutePlan(this, plan);
  }

  /**
   * Schedule stutter effects for a given unit-level note.
   * Passes beatContext so stutterNotes can cooperate with CC effects.
   * @param {any} opts
   * @returns {any} shared state from stutterNotes
   */
  scheduleStutterForUnit(opts = {}) {
    if (typeof stutterNotes !== 'function') throw new Error('StutterManager.scheduleStutterForUnit: stutterNotes helper not available');
    const provided = Object.assign({}, opts);
    if (!provided.shared) provided.shared = this.shared;

    // merge default directive into unit-stutter opts when present (coherence only currently)
    provided.beatContext = this.beatContext || {};
    if (!provided.beatContext.coherenceKey && this.defaultDirective && this.defaultDirective.coherence && this.defaultDirective.coherence.enabled) {
      const prefix = this.defaultDirective.coherence.keyPrefix || 'stutter';
      const seed = provided.coherenceGroup || provided.coherenceKey || 'unit';
      provided.beatContext.coherenceKey = `${prefix}:${seed}`;
    }

    StutterMetrics.incScheduled(1, provided.profile || 'unknown');
    return stutterNotes(provided);
  }

  prepareBeat() {
    this._attachTextureListener();
    // Idempotent per-beat setup: apply default directive (coherenceKey, reset per-beat selectors)
    if (!this.beatContext) this.beatContext = {};
    // Reset per-beat selection sets when beatIndex changes
    const currentBeatIndexLocal = (typeof beatIndex !== 'undefined') ? beatIndex : null;
    if (this.beatContext._lastBeatIndex !== currentBeatIndexLocal) {
      this.beatContext._lastBeatIndex = currentBeatIndexLocal;
      this.beatContext.selectedReflectionChannels = new Set();
      this.beatContext.selectedBassChannels = new Set();

      // Texture coupling (#1): when recent flurry activity is high, suppress
      // stutter channel selection so flurry runs breathe without fragmentation
      const textureSuppression = (this._lastTextureMode === 'flurry' && this._textureIntensity > 0.15)
        ? clamp(1 - this._textureIntensity * 1.5, 0.1, 0.5) // lower selection chance
        : 0.5;

      if (typeof reflection === 'undefined' || !Array.isArray(reflection)) {
        throw new Error('StutterManager.prepareBeat: reflection channels array is not available');
      }
      if (typeof bass === 'undefined' || !Array.isArray(bass)) {
        throw new Error('StutterManager.prepareBeat: bass channels array is not available');
      }
      const reflCandidates = reflection.slice();
      for (const ch of reflCandidates) if (this.beatContext.selectedReflectionChannels.size < 2 && rf() < textureSuppression) this.beatContext.selectedReflectionChannels.add(ch);
      const bassCandidates = bass.slice();
      for (const ch of bassCandidates) if (this.beatContext.selectedBassChannels.size < 2 && rf() < textureSuppression) this.beatContext.selectedBassChannels.add(ch);
    }

    // Apply default coherence key if enabled in defaultDirective
    const def = this.defaultDirective;
    if (!def || typeof def !== 'object') {
      throw new Error('StutterManager.prepareBeat: defaultDirective is not initialized');
    }
    if (def.coherence && def.coherence.enabled) {
      const prefix = (def.coherence && typeof def.coherence.keyPrefix === 'string' && def.coherence.keyPrefix.length > 0) ? def.coherence.keyPrefix : 'stutter';
      const seed = `${typeof measureIndex !== 'undefined' ? measureIndex : 'm'}:${typeof beatIndex !== 'undefined' ? beatIndex : 'b'}`;
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
Stutter = new StutterManager();

// Delegator wrappers for runtime/tests (minimal and fail-fast).
stutterFade = (...args) => Stutter.stutterFade(...args);
stutterPan = (...args) => Stutter.stutterPan(...args);
stutterFX = (...args) => Stutter.stutterFX(...args);
