// fx/StutterManager.js - Audio effects manager

class StutterManager {
  constructor() {
    // Channel tracking state for fade/pan/FX stutters
    this.lastUsedCHs = new Set();      // for stutterFade
    this.lastUsedCHs2 = new Set();     // for stutterPan and stutterFX

    // Bind external implementations (keeps tests and callers stable)
    try { require('./stutterFade'); } catch (e) { /* swallow */ }
    try { require('./stutterPan'); } catch (e) { /* swallow */ }
    try { require('./stutterFX'); } catch (e) { /* swallow */ }
    try { require('./resetChannelTracking'); } catch (e) { /* swallow */ }

    // Capture the naked globals if present (project convention)
    this._stutterFade = (typeof stutterFade !== 'undefined') ? stutterFade : null;
    this._stutterPan = (typeof stutterPan !== 'undefined') ? stutterPan : null;
    this._stutterFX = (typeof stutterFX !== 'undefined') ? stutterFX : null;
    this._resetChannelTracking = (typeof resetChannelTracking !== 'undefined') ? resetChannelTracking : null;
  }

  stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
    try {
      if (!channels) return;
      if (this._stutterFade) return this._stutterFade.call(this, channels, numStutters, duration);
    } catch (e) { /* swallow */ }
  }

  stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
    try {
      if (!channels) return;
      if (this._stutterPan) return this._stutterPan.call(this, channels, numStutters, duration);
    } catch (e) { /* swallow */ }
  }

  stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
    try {
      if (!channels) return;
      if (this._stutterFX) return this._stutterFX.call(this, channels, numStutters, duration);
    } catch (e) { /* swallow */ }
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
        try { this._resetChannelTracking.call(this, channels); } catch (e) { /* swallow */ }
      }
      return { cleared: channels.length };
    }

    // Full reset - always clear internal state first
    const prev1 = this.lastUsedCHs.size;
    const prev2 = this.lastUsedCHs2.size;
    // DEBUG
    try { if (typeof console !== 'undefined' && console && typeof console.debug === 'function') console.debug('resetChannelTracking/full', { prev1, prev2, _resetHook: !!this._resetChannelTracking }); } catch (e) { /* swallow */ }
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();

    // Call external hook for compatibility (do not trust its return value)
    if (this._resetChannelTracking && this._resetChannelTracking !== this.resetChannelTracking) {
      try { this._resetChannelTracking.call(this, channels); } catch (e) { /* swallow */ }
    }

    return { cleared: prev1 + prev2, lastUsedCHs: prev1, lastUsedCHs2: prev2 };
  }
}

// Export StutterManager instance and class to global namespace
Stutter = new StutterManager();
