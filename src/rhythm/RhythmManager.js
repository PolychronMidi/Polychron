// RhythmManager.js - single manager hub for rhythm subsystem

class RhythmManager_ {
  static listGenerators() { return RhythmRegistry.list(); }

  static getGenerator(name) { return RhythmRegistry.get(name); }

  static getPattern(level, length, pattern, method, ...args) {
    if (method) {
      const fn = RhythmRegistry.get(method);
      return fn(...args);
    }

    // fallback behavior: use existing getRhythm logic via globals - but fail fast if no candidate
    const p = getRhythm(level, length, pattern, method, ...args);
    if (!p) throw new Error('RhythmManager.getPattern: getRhythm returned falsy pattern');
    return p;
  }

  /**
   * Rhythm value helpers proxied from `RhythmValues` for centralized access.
   */
  static quantizeTime(time, resolution) {
    return RhythmValues.quantizeTime(time, resolution);
  }

  static swingOffset(beatIndex, amount) {
    return RhythmValues.swingOffset(beatIndex, amount);
  }

  static accentWeight(beatIndex, pattern) {
    return RhythmValues.accentWeight(beatIndex, pattern);
  }

  static applyToNote(note, hit, profileName, options = {}) {
    const profile = profileName ? rhythmConfig.getProfile(profileName) : null;
    if (options !== undefined && (typeof options !== 'object' || options === null)) throw new Error('RhythmManager.applyToNote: options must be an object if provided');
    const opts = Object.assign({}, profile || {}, options);
    return rhythmModulator.apply(note, hit, opts);
  }
}

RhythmManager = RhythmManager_;
