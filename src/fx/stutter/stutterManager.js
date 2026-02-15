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
