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
    applyToNote
  };
})();
