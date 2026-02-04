// fx/StutterManager.js - Audio effects manager

// Use centralized stutterConfig for config/metrics/helper registration/logging
const SC = (typeof StutterConfig !== 'undefined') ? StutterConfig : null;

// Capture reference to original helper (before we reassign global stutterNotes delegator at bottom)
let _stutterNotesHelper = (typeof stutterNotes === 'function') ? stutterNotes : null;
// Note: Do not require modules from within fx files (project lint rule). If the helper is not available at
// load time we will detect and use the registered helper at call time while avoiding recursion.

class StutterManager {
  constructor() {
    // Channel tracking state for fade/pan/FX stutters
    this.lastUsedCHs = new Set();      // for stutterFade
    this.lastUsedCHs2 = new Set();     // for stutterPan and stutterFX

    // Implementations (stutterFade, stutterPan, stutterFX) are provided by `src/fx/index.js` (aggregated side-effect requires)

    // Capture the naked globals (rely on require-side effects to define them)
    this._stutterFade = (typeof stutterFade === 'function') ? stutterFade : null;
    this._stutterPan = (typeof stutterPan === 'function') ? stutterPan : null;
    this._stutterFX = (typeof stutterFX === 'function') ? stutterFX : null;
    // Shared state for stutterNotes (stutters/shifts/global) — shared across manager usage; callers may pass custom shared per group
    this.shared = { stutters: new Map(), shifts: new Map(), global: {} };

    // Use central config object from stutterConfig (read-only reference)
    this.config = (SC && SC.getConfig ? SC.getConfig() : { probabilities: {}, fallbackVelocity: 64 });

    // Pending scheduled events: Map<tick, Array<event>>
    this.pending = new Map();

    // Optional external hook which can override/reset channel tracking
    this._resetChannelTracking = null;

    // Instance-level helper override (for tests)
    this._helperOverride = null;
  }

  stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
    if (!channels) { console.warn('StutterManager.stutterFade: called with no channels — skipping'); return { skipped: true }; }
    if (typeof this._stutterFade === 'function') return this._stutterFade.call(this, channels, numStutters, duration);
    return null;
  }

  stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
    if (!channels) { console.warn('StutterManager.stutterPan: called with no channels — skipping'); return { skipped: true }; }
    if (typeof this._stutterPan === 'function') return this._stutterPan.call(this, channels, numStutters, duration);
    return null;
  }

  stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
    if (!channels) { console.warn('StutterManager.stutterFX: called with no channels — skipping'); return { skipped: true }; }
    if (typeof this._stutterFX === 'function') return this._stutterFX.call(this, channels, numStutters, duration);
    return null;
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
    // propagate manager config into helper options so tests/runtime can tune behavior
    provided.config = Object.assign({}, this.config, provided.config || {});
    if (typeof _stutterNotesHelper === 'function') return _stutterNotesHelper(provided);
    // Do NOT call global `stutterNotes` from here - it may be the manager delegator and cause recursion.
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') console.warn('stutterNotes: helper not available');
    return null;
  }
  /**
   * Schedule a stutter plan for a given unit-level note. This collects events from `stutterNotes` and stores them in the pending queue.
   * @param {any} opts
   * @returns {number} number of events scheduled
   */
  scheduleStutterForUnit(opts = {}) {
    const provided = Object.assign({}, opts);
    if (!provided.shared) provided.shared = this.shared;
    // propagate manager config into the scheduling call
    provided.config = Object.assign({}, this.config, provided.config || {});
    provided.emit = false;
    // If NoteCascade exists, delegate scheduling there to handle cascades across units
    if (typeof NoteCascade !== 'undefined' && NoteCascade && typeof NoteCascade.scheduleNoteCascade === 'function') {
      return NoteCascade.scheduleNoteCascade(this, provided);
    }

    // Fallback: inline scheduling logic (keeps behavior when NoteCascade not loaded)
    // Prefer a captured helper but ensure it is not the manager delegator itself (avoid recursion)
    // Allow an instance-level override (set via setStutterNotesHelper) as highest priority
    // Prefer instance override, then registered helper from stutterConfig; avoid calling manager delegator
    let helper = (typeof this._helperOverride === 'function') ? this._helperOverride : (SC && SC.getRegisteredHelper ? SC.getRegisteredHelper() : null);
    if (helper === null) {
      if (SC && SC.logDebug) SC.logDebug('scheduleStutterForUnit: no stutterNotes helper available (will use fallback on event)');
      // If we have no safe helper, we will still use fallback 'on' event behavior below
    }
    let events = [];
    if (!helper || typeof helper !== 'function') {
      if (SC && SC.logDebug) SC.logDebug('scheduleStutterForUnit: no valid helper available, skipping helper call');
    } else if (helper === this.stutterNotes) {
      // helper resolved to the manager delegator (could be due to load order); avoid recursion and fall back
      if (SC && SC.logDebug) SC.logDebug('scheduleStutterForUnit: helper resolved to manager delegator, skipping helper call');
    } else {
      const result = helper(provided);
      // result is { shared, events }
      events = result && result.events ? result.events : [];
    }
    if (SC && SC.logDebug) SC.logDebug('scheduleStutterForUnit: events', events.length, events.map(e => Math.round(e.tick)));
    let added = 0;
    for (const ev of events) {
        // annotate events with profile for metrics later (internal-only)
      ev._profile = provided.profile || 'unknown';
      const key = Math.round(ev.tick);
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key).push(ev);
      // track pending counts by tick
      if (SC && SC.incPendingForTick) SC.incPendingForTick(key, 1);
      added++;
    }

    // Ensure at least the original 'on' event is present at the requested 'on' tick when no events were produced
    const onTick = Math.round(provided.on);
    const hasOnAtRequested = events.some(ev => Math.round(ev.tick) === onTick || (ev.type === 'on' && Math.round(ev.tick) === onTick));
    if (!hasOnAtRequested) {
      const fallbackEv = { tick: provided.on, type: 'on', vals: [provided.channel, provided.note, provided.velocity || provided.binVel || (SC && SC.getConfig ? SC.getConfig().fallbackVelocity : 64)], _profile: provided.profile || 'unknown' };
      if (!this.pending.has(onTick)) this.pending.set(onTick, []);
      this.pending.get(onTick).push(fallbackEv);
      if (SC && SC.incPendingForTick) SC.incPendingForTick(onTick, 1);
      added++;
    }

    // update metrics
    if (SC && SC.incScheduled) SC.incScheduled(added, provided.profile || 'unknown');

    return added;
  }

  /**
   * Emit any pending events scheduled for the given absolute tick.
   * @param {number} tick
   * @returns {number} number of events emitted
   */
  playPendingForTick(tick) {
    const key = Math.round(tick);
    const arr = this.pending.get(key);
    if (!arr || !arr.length) return 0;
    // update metrics and emit
    for (const ev of arr) {
      try { p(c, ev);
        // per-profile metrics
        const prof = ev._profile || 'unknown';
        if (SC && SC.incEmitted) SC.incEmitted(1, prof);
      } catch (e) { console.warn('StutterManager.playPendingForTick: emit failed', e && e.stack ? e.stack : e); }
    }
    this.pending.delete(key);
    // adjust pendingByTick
    if (SC && SC.decPendingForTick) SC.decPendingForTick(key, arr.length);
    if (SC && SC.logDebug) SC.logDebug('playPendingForTick: emitted', key, arr.length);
    return arr.length;
  }

  // Expose metrics accessors for tests and tuning
  getMetrics() {
    return (SC && SC.getMetrics) ? SC.getMetrics() : { scheduledCount: 0, emittedCount: 0, scheduledByProfile: {}, emittedByProfile: {}, pendingByTick: new Map() };
  }

  resetMetrics() {
    return (SC && SC.resetMetrics) ? SC.resetMetrics() : true;
  }

  // For tests or runtime adjustments we allow swapping the helper implementation
  setStutterNotesHelper(fn) {
    // mark and register as original helper, and set instance override
    if (SC && SC.registerOriginalHelper) SC.registerOriginalHelper(fn);
    this._helperOverride = (typeof fn === 'function') ? fn : null;
    _stutterNotesHelper = (typeof fn === 'function') ? fn : null;
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
    // DEBUG
    if (SC && SC.logDebug) SC.logDebug('resetChannelTracking/full', { prev1, prev2, _resetHook: Boolean(this._resetChannelTracking) });
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
