// fx/StutterManager.js - Audio effects manager

class StutterManager {
  constructor() {
    // Channel tracking state for fade/pan/FX stutters
    this.lastUsedCHs = new Set();      // for stutterFade
    this.lastUsedCHs2 = new Set();     // for stutterPan and stutterFX

    // Bind external implementations via require side-effects (fail fast if missing)
    // @ts-ignore: load side-effect module with globals
    require('./stutterFade');
    // @ts-ignore: load side-effect module with globals
    require('./stutterPan');
    // @ts-ignore: load side-effect module with globals
    require('./stutterFX');

    // Capture the naked globals (rely on require-side effects to define them)
    this._stutterFade = stutterFade;
    this._stutterPan = stutterPan;
    this._stutterFX = stutterFX;
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
    if (typeof console !== 'undefined' && console && typeof console.debug === 'function') console.debug('resetChannelTracking/full', { prev1, prev2, _resetHook: Boolean(this._resetChannelTracking) });
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();

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
