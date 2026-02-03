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

  resetChannelTracking() {
    if (this._resetChannelTracking) return this._resetChannelTracking.call(this);
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();
  }
}
// Bind instance methods to naked globals for backwards compatibility
try { stutterFade = Stutter && typeof Stutter.stutterFade === 'function' ? Stutter.stutterFade.bind(Stutter) : stutterFade; } catch (e) { /* swallow */ }
try { stutterPan = Stutter && typeof Stutter.stutterPan === 'function' ? Stutter.stutterPan.bind(Stutter) : stutterPan; } catch (e) { /* swallow */ }
try { stutterFX = Stutter && typeof Stutter.stutterFX === 'function' ? Stutter.stutterFX.bind(Stutter) : stutterFX; } catch (e) { /* swallow */ }

// Export StutterManager instance and class to global namespace
Stutter = new StutterManager();
