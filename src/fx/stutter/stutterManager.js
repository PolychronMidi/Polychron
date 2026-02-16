// fx/StutterManager.js - Audio effects manager

const SC = (typeof StutterConfig !== 'undefined') ? StutterConfig : null;

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

    // Plan scheduling: explicit plan objects (opt-in global stutter phrases)
    // plans: Map<planId, planCfg>
    this.plans = new Map();
    this.scheduledPlans = new Map(); // tickKey -> [planId,...]
    this._nextPlanId = 1;

    this.config = (SC && SC.getConfig ? SC.getConfig() : { profiles: {} });
  }

  stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
    if (!channels || (Array.isArray(channels) && channels.length === 0)) throw new Error('StutterManager.stutterFade: called with no channels');
    if (!Number.isFinite(Number(numStutters)) || numStutters <= 0) throw new Error('StutterManager.stutterFade: numStutters must be a positive number');
    if (!Number.isFinite(Number(duration)) || duration <= 0) throw new Error('StutterManager.stutterFade: duration must be positive');
    if (typeof this._stutterFade !== 'function') throw new Error('StutterManager.stutterFade: implementation not available');
    return this._stutterFade.call(this, channels, Number(numStutters), Number(duration));
  }

  stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
    if (!channels || (Array.isArray(channels) && channels.length === 0)) throw new Error('StutterManager.stutterPan: called with no channels');
    if (!Number.isFinite(Number(numStutters)) || numStutters <= 0) throw new Error('StutterManager.stutterPan: numStutters must be a positive number');
    if (!Number.isFinite(Number(duration)) || duration <= 0) throw new Error('StutterManager.stutterPan: duration must be positive');
    if (typeof this._stutterPan !== 'function') throw new Error('StutterManager.stutterPan: implementation not available');
    return this._stutterPan.call(this, channels, Number(numStutters), Number(duration));
  }

  stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
    if (!channels || (Array.isArray(channels) && channels.length === 0)) throw new Error('StutterManager.stutterFX: called with no channels');
    if (!Number.isFinite(Number(numStutters)) || numStutters <= 0) throw new Error('StutterManager.stutterFX: numStutters must be a positive number');
    if (!Number.isFinite(Number(duration)) || duration <= 0) throw new Error('StutterManager.stutterFX: duration must be positive');
    if (typeof this._stutterFX !== 'function') throw new Error('StutterManager.stutterFX: implementation not available');
    return this._stutterFX.call(this, channels, Number(numStutters), Number(duration));
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
      try { if (typeof StutterMetrics !== 'undefined' && StutterMetrics && typeof StutterMetrics.incScheduled === 'function') StutterMetrics.incScheduled(1, plan.profile || 'unknown'); } catch { /* ignore */ }
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
        if (plan) this._executePlan(plan);
      }
      this.scheduledPlans.delete(k);
    }
    return true;
  }

  /**
   * Internal: execute plan object by calling `stutterNotes` across the plan channels/ticks.
   */
  _executePlan(plan = {}) {
    const cfg = /** @type {any} */ (Object.assign({}, plan));
    const profile = cfg.profile || 'source';
    const baseNote = Number.isFinite(Number(cfg.note)) ? Number(cfg.note) : null;
    if (!Number.isFinite(baseNote)) throw new Error('StutterManager._executePlan: plan.note (base MIDI note) is required');
    const on = Number.isFinite(Number(cfg.on)) ? Number(cfg.on) : (typeof beatStart !== 'undefined' ? Number(beatStart) : 0);
    const sustain = Number.isFinite(Number(cfg.sustain)) ? Number(cfg.sustain) : tpSec * 0.25;
    const numStutters = Number.isFinite(Number(cfg.numStutters)) ? Number(cfg.numStutters) : m.max(1, ri(2, 6));
    const duration = Number.isFinite(Number(cfg.duration)) ? Number(cfg.duration) : Math.max(0.001, (sustain / numStutters) * rf(.9, 1.1));

    // target channels - default to profile channel groups
    let channels = Array.isArray(cfg.channels) && cfg.channels.length > 0 ? cfg.channels.slice() : null;
    if (!channels) {
      if (profile === 'reflection') channels = (typeof reflection !== 'undefined' ? reflection.slice() : []);
      else if (profile === 'bass') channels = (typeof bass !== 'undefined' ? bass.slice() : []);
      else channels = (typeof source !== 'undefined' ? source.slice() : []);
    }

    // Execute: for each step, call stutterNotes for each target channel (uses manager.shared for continuity)
    for (let i = 0; i < numStutters; i++) {
      const stepTick = on + i * (duration) * rf(.9, 1.1);
      for (const ch of channels) {
        try {
          stutterNotes({ profile, channel: ch, note: baseNote, on: stepTick, sustain: duration, velocity: cfg.maxVelocity || 100, binVel: cfg.maxVelocity || 100, isPrimary: false, shared: this.shared, beatContext: this.beatContext });
        } catch { /* ignore per-channel errors */ }
      }
    }

    try { if (typeof StutterMetrics !== 'undefined' && StutterMetrics && typeof StutterMetrics.incEmitted === 'function') StutterMetrics.incEmitted(numStutters * channels.length, profile); } catch { /* ignore */ }
    return cfg;
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
    provided.beatContext = this.beatContext;
    try { if (typeof StutterMetrics !== 'undefined' && StutterMetrics && typeof StutterMetrics.incScheduled === 'function') StutterMetrics.incScheduled(1, provided.profile || 'unknown'); } catch { /* ignore */ }
    return stutterNotes(provided);
  }

  resetChannelTracking(channels = null) {
    if (Array.isArray(channels) && channels.length > 0) {
      for (const ch of channels) {
        this.lastUsedCHs.delete(ch);
        this.lastUsedCHs2.delete(ch);
        this.lastUsedCHs3.delete(ch);
      }
      return { cleared: channels.length };
    }

    const prev1 = this.lastUsedCHs.size;
    const prev2 = this.lastUsedCHs2.size;
    const prev3 = this.lastUsedCHs3.size;
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();
    this.lastUsedCHs3.clear();
    this.beatContext = {};
    try { this.shared.shifts.clear(); this.shared.global = {}; } catch { /* ignore errors clearing shared state */ }

    return { cleared: prev1 + prev2 + prev3, lastUsedCHs: prev1, lastUsedCHs2: prev2, lastUsedCHs3: prev3 };
  }
}

// Export StutterManager instance and class to global namespace
Stutter = new StutterManager();

// Delegator wrappers for runtime/tests (minimal and fail-fast).
stutterFade = (...args) => Stutter.stutterFade(...args);
stutterPan = (...args) => Stutter.stutterPan(...args);
stutterFX = (...args) => Stutter.stutterFX(...args);
