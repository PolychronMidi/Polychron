// fx/StutterManager.js - Audio effects manager moved into `src/fx` folder
// Minimal changes from original: still exports `fx` global and keeps class interface.

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

  stutterFade(channels, numStutters, duration) {
    if (this._stutterFade) return this._stutterFade.call(this, channels, numStutters, duration);
  }

  stutterPan(channels, numStutters, duration) {
    if (this._stutterPan) return this._stutterPan.call(this, channels, numStutters, duration);
  }

  stutterFX(channels, numStutters, duration) {
    if (this._stutterFX) return this._stutterFX.call(this, channels, numStutters, duration);
  }

  resetChannelTracking() {
    if (this._resetChannelTracking) return this._resetChannelTracking.call(this);
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();
  }
}

// Export StutterManager instance and class to global namespace
Stutter = new StutterManager();

// Side-effect: `Stutter` and `StutterManager` are available as globals/exports via the fx module.
