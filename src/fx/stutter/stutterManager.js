// fx/StutterManager.js - Audio effects manager

// Use centralized stutterConfig for config/metrics/helper registration/logging
const SC = (typeof StutterConfig !== 'undefined') ? StutterConfig : null;

class StutterManager {
  constructor() {
    // Channel tracking state for fade/pan/FX stutters
    this.lastUsedCHs = new Set();      // for stutterFade
    this.lastUsedCHs2 = new Set();     // for stutterPan and stutterFX

    // Capture the naked globals (rely on require-side effects to define them)
    this._stutterFade = (typeof stutterFade === 'function') ? stutterFade : null;
    this._stutterPan = (typeof stutterPan === 'function') ? stutterPan : null;
    this._stutterFX = (typeof stutterFX === 'function') ? stutterFX : null;
    // Shared state for stutterNotes (stutters/shifts/global) — shared across manager usage; callers may pass custom shared per group
    this.shared = { stutters: new Map(), shifts: new Map(), global: {} };

    // Use central config object from stutterConfig (read-only reference)
    this.config = (SC && SC.getConfig ? SC.getConfig() : { probabilities: {} });

    // Pending scheduled events: Map<tick, Array<event>>
    this.pending = new Map();

    // Optional external hook which can override/reset channel tracking
    this._resetChannelTracking = null;
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

  /**
   * Delegate to the stutterNotes helper while ensuring shared state is passed.
   * When `emit` is false the helper returns planned events instead of calling p();
   * this method can be used for scheduling instead of immediate emission.
   * @param {Object} opts
   * @returns {any} shared object when emit=true, or { shared, events } when emit=false
   */
  /**
   * Delegate to stutterNotes helper. Accepts arbitrary opts forwarded to helper.
   * @param {any} opts
   * @returns {any}
   */
  stutterNotes(opts = {}) {
    const provided = Object.assign({}, opts);
    if (!provided.shared) provided.shared = this.shared;
    // Validate provided.config if present
    if (provided.config !== undefined && (typeof provided.config !== 'object' || provided.config === null)) {
      throw new Error('StutterManager.stutterNotes: provided.config must be an object if provided');
    }
    // Refresh config every call so runtime updates take effect
    const liveConfig = (SC && SC.getConfig) ? SC.getConfig() : this.config;
    this.config = liveConfig;
    provided.config = Object.assign({}, liveConfig, provided.config || {});
    const helper = (SC && typeof SC.getHelper === 'function') ? SC.getHelper() : undefined;
    if (typeof helper === 'function') return helper(provided);
    throw new Error('stutterNotes: helper not available');
  }
  /**
   * Schedule a stutter plan for a given unit-level note. This delegates to the naked global `noteCascade` function
   * and will throw if it is not available. This enforces fail-fast behavior so runtime code cannot silently fall back to implicit behavior.
   * @param {any} opts
   * @returns {number} number of events scheduled
   */
  scheduleStutterForUnit(opts = {}) {
    const provided = Object.assign({}, opts);
    if (!provided.shared) provided.shared = this.shared;
    if (provided.config !== undefined && (typeof provided.config !== 'object' || provided.config === null)) {
      throw new Error('StutterManager.scheduleStutterForUnit: provided.config must be an object if provided');
    }
    const liveConfig = (SC && SC.getConfig) ? SC.getConfig() : this.config;
    this.config = liveConfig;
    provided.config = Object.assign({}, liveConfig, provided.config || {});
    provided.emit = false;

    const helper = (SC && typeof SC.getHelper === 'function') ? SC.getHelper() : undefined;
    if (typeof helper !== 'function') throw new Error('StutterManager.scheduleStutterForUnit: stutter helper not available');

    const result = helper(provided);
    if (!result || !Array.isArray(result.events)) return 0;

    const events = result.events;
    let added = 0;
    for (const ev of events) {
      ev._profile = provided.profile || 'unknown';
      if (!Number.isFinite(Number(ev.tick))) {
        throw new Error(`scheduleStutterForUnit: skipping event with invalid tick: ${JSON.stringify(ev)}`);
      }
      const key = m.round(ev.tick);
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key).push(ev);
      if (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.incPendingForTick === 'function') StutterConfig.incPendingForTick(key, 1);
      added++;
    }
    if (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.incScheduled === 'function') StutterConfig.incScheduled(added, provided.profile || 'unknown');
    return added;
  }

  /**
   * Emit any pending events scheduled for the given absolute tick.
   * @param {number} tick
   * @returns {number} number of events emitted
   */
  playPendingForTick(tick) {
    const key = m.round(tick);
    const arr = this.pending.get(key);
    if (!arr || !arr.length) return 0;
    // update metrics and emit
    for (const ev of arr) {
      try { p(c, ev);
        // per-profile metrics
        const prof = ev._profile || 'unknown';
        if (SC && SC.incEmitted) SC.incEmitted(1, prof);
      } catch (e) { throw e; }
    }
    this.pending.delete(key);
    // adjust pendingByTick
    if (SC && SC.decPendingForTick) SC.decPendingForTick(key, arr.length);
    return arr.length;
  }

  // Metrics accessors for tests and tuning (explicit accessor methods below)
  getMetrics() {
    return (SC && SC.getMetrics) ? SC.getMetrics() : { scheduledCount: 0, emittedCount: 0, scheduledByProfile: {}, emittedByProfile: {}, pendingByTick: new Map() };
  }

  resetMetrics() {
    return (SC && SC.resetMetrics) ? SC.resetMetrics() : true;
  }

  // For tests or runtime adjustments we allow swapping the helper implementation
  setStutterNotesHelper(fn) {
    if (SC && typeof SC.registerHelper === 'function') SC.registerHelper(fn);
    return true;
  }

  resetChannelTracking(channels = null) {
    // If channels provided, clear only those channels from tracking sets
    if (Array.isArray(channels) && channels.length > 0) {
      for (const ch of channels) {
        this.lastUsedCHs.delete(ch);
        this.lastUsedCHs2.delete(ch);
      }
      // Call external hook for compatibility but always perform internal clear first
      if (this._resetChannelTracking && this._resetChannelTracking !== this.resetChannelTracking) {
        this._resetChannelTracking.call(this, channels);
      }
      return { cleared: channels.length };
    }

    // Full reset - always clear internal state first
    const prev1 = this.lastUsedCHs.size;
    const prev2 = this.lastUsedCHs2.size;
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();
    // Also clear shared stutter state and pending events
    try { this.shared.stutters.clear(); this.shared.shifts.clear(); this.shared.global = {}; } catch (e) { /* ignore errors clearing shared state */ }
    this.pending.clear();

    // Call external hook for compatibility — allow errors to surface
    if (this._resetChannelTracking && this._resetChannelTracking !== this.resetChannelTracking) {
      this._resetChannelTracking.call(this, channels);
    }

    return { cleared: prev1 + prev2, lastUsedCHs: prev1, lastUsedCHs2: prev2 };
  }
}

// Export StutterManager instance and class to global namespace
Stutter = new StutterManager();

// Delegator wrappers for runtime/tests (minimal and fail-fast).
stutterFade = (...args) => Stutter.stutterFade(...args);
stutterPan = (...args) => Stutter.stutterPan(...args);
stutterFX = (...args) => Stutter.stutterFX(...args);
