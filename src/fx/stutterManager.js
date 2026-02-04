// fx/StutterManager.js - Audio effects manager

// Debug logging helper: only prints debug messages when DEBUG / NODE_DEBUG or process.env.DEBUG set
const DEBUG = !!(typeof process !== 'undefined' && (process.env.DEBUG === 'true' || process.env.DEBUG === '1' || process.env.NODE_DEBUG));
function logDebug(...args) { if (DEBUG && typeof console !== 'undefined' && console && typeof console.debug === 'function') console.debug(...args); }

// Capture reference to original helper (before we reassign global stutterNotes delegator at bottom)
let _stutterNotesHelper = (typeof stutterNotes === 'function') ? stutterNotes : null;
// Note: Do not require modules from within fx files (project lint rule). If the helper is not available at
// load time we will detect and use the global `stutterNotes` at call time while avoiding recursion.

class StutterManager {
  constructor() {
    // Channel tracking state for fade/pan/FX stutters
    this.lastUsedCHs = new Set();      // for stutterFade
    this.lastUsedCHs2 = new Set();     // for stutterPan and stutterFX

    // Implementations (stutterFade, stutterPan, stutterFX) are provided by `src/fx/index.js` (aggregated side-effect requires)

    // Capture the naked globals (rely on require-side effects to define them)
    this._stutterFade = stutterFade;
    this._stutterPan = stutterPan;
    this._stutterFX = stutterFX;
    // Shared state for stutterNotes (stutters/shifts/global) — shared across manager usage; callers may pass custom shared per group
    this.shared = { stutters: new Map(), shifts: new Map(), global: {} };
    // Pending scheduled events: Map<tick, Array<event>>
    this.pending = new Map();
    // Optional external hook which can override/reset channel tracking
    this._resetChannelTracking = null;
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
    if (typeof _stutterNotesHelper === 'function') return _stutterNotesHelper(provided);
    return stutterNotes(provided); // fallback (shouldn't recurse)
  }

  /**
   * Schedule a stutter plan for a given unit-level note. This collects events from `stutterNotes` and stores them in the pending queue.
   * @param {any} opts
   * @returns {number} number of events scheduled
   */
  scheduleStutterForUnit(opts = {}) {
    const provided = Object.assign({}, opts);
    if (!provided.shared) provided.shared = this.shared;
    provided.emit = false;
    let helper = (typeof _stutterNotesHelper === 'function') ? _stutterNotesHelper : (typeof stutterNotes === 'function' && stutterNotes !== this.stutterNotes ? stutterNotes : null);
    if (helper === null) {
      if (typeof console !== 'undefined' && console && typeof console.warn === 'function') console.warn('scheduleStutterForUnit: no stutterNotes helper available');
      return 0;
    }
    const result = helper(provided);
    // result is { shared, events }
    const events = result && result.events ? result.events : [];
    logDebug('scheduleStutterForUnit: events', events.length, events.map(e => Math.round(e.tick)));
    let added = 0;
    for (const ev of events) {
      const key = Math.round(ev.tick);
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key).push(ev);
      added++;
    }

    // Ensure at least the original 'on' event is present at the requested 'on' tick when no events were produced
    const onTick = Math.round(provided.on);
    const hasOnAtRequested = events.some(ev => Math.round(ev.tick) === onTick || (ev.type === 'on' && Math.round(ev.tick) === onTick));
    if (!hasOnAtRequested) {
      const fallbackEv = { tick: provided.on, type: 'on', vals: [provided.channel, provided.note, provided.velocity || provided.binVel || 64] };
      if (!this.pending.has(onTick)) this.pending.set(onTick, []);
      this.pending.get(onTick).push(fallbackEv);
      added++;
    }

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
    for (const ev of arr) {
      try { p(c, ev); } catch (e) { console.warn('StutterManager.playPendingForTick: emit failed', e && e.stack ? e.stack : e); }
    }
    this.pending.delete(key);
    return arr.length;
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
    logDebug('resetChannelTracking/full', { prev1, prev2, _resetHook: Boolean(this._resetChannelTracking) });
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
// Backwards-compatible delegator for per-note helper so existing call sites keep working
stutterNotes = (...args) => Stutter.stutterNotes(...args);
