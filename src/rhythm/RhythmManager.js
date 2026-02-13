// RhythmManager.js - single manager hub for rhythm subsystem

RhythmManager = (function() {
  const registry = RhythmRegistry;
  const values = RhythmValues;
  const mod = rhythmModulator;
  const config = rhythmConfig;

  function listGenerators() { return registry.list(); }

  function getGenerator(name) { return registry.get(name); }

  function getPattern(level, length, pattern, method, ...args) {
    if (method) {
      const fn = registry.get(method);
      return fn(...args);
    }

    // fallback behavior: use existing getRhythm logic via globals - but fail fast if no candidate
    try {
      const p = getRhythm(level, length, pattern, method, ...args);
      if (!p) throw new Error('RhythmManager.getPattern: getRhythm returned falsy pattern');
      return p;
    } catch (e) {
      throw new Error(`RhythmManager.getPattern failed: ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * Rhythm value helpers proxied from `RhythmValues` for centralized access.
   */
  function quantizeTime(time, resolution) {
    if (typeof values !== 'object' || typeof values.quantizeTime !== 'function') {
      throw new Error('RhythmManager.quantizeTime: RhythmValues.quantizeTime not available');
    }
    return values.quantizeTime(time, resolution);
  }

  function swingOffset(beatIndex, amount) {
    if (typeof values !== 'object' || typeof values.swingOffset !== 'function') {
      throw new Error('RhythmManager.swingOffset: RhythmValues.swingOffset not available');
    }
    return values.swingOffset(beatIndex, amount);
  }

  function accentWeight(beatIndex, pattern) {
    if (typeof values !== 'object' || typeof values.accentWeight !== 'function') {
      throw new Error('RhythmManager.accentWeight: RhythmValues.accentWeight not available');
    }
    return values.accentWeight(beatIndex, pattern);
  }

  function applyToNote(note, hit, profileName, options = {}) {
    const profile = profileName ? config.getProfile(profileName) : null;
    if (options !== undefined && (typeof options !== 'object' || options === null)) throw new Error('RhythmManager.applyToNote: options must be an object if provided');
    const opts = Object.assign({}, profile || {}, options);
    return mod.apply(note, hit, opts);
  }

  return {
    listGenerators,
    getGenerator,
    getPattern,
    applyToNote,
    quantizeTime,
    swingOffset,
    accentWeight
  };
})();
