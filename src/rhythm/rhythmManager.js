// rhythmManager.js - single manager hub for rhythm subsystem

class RhythmManager_ {
  /** @type {ValidatorInstance} */
  static _V;
  static { this._V = validator.create('rhythmManager'); }
  static listGenerators() { return rhythmRegistry.list(); }

  static getGenerator(name) { return rhythmRegistry.get(name); }

  static getPattern(level, length, pattern, method, ...args) {
    if (method) {
      const fn = rhythmRegistry.get(method);
      return fn(...args);
    }

    // fallback behavior: use existing getRhythm logic via globals - but fail fast if no candidate
    const p = getRhythm(level, length, pattern, method, ...args);
    if (!p) throw new Error('rhythmManager.getPattern: getRhythm returned falsy pattern');
    return p;
  }

  /**
   * Rhythm value helpers proxied from `rhythmValues` for centralized access.
   */
  static quantizeTime(time, resolution) {
    return rhythmValues.quantizeTime(time, resolution);
  }

  static swingOffset(beatIndex, amount) {
    return rhythmValues.swingOffset(beatIndex, amount);
  }

  static accentWeight(beatIndex, pattern) {
    return rhythmValues.accentWeight(beatIndex, pattern);
  }

  static applyToNote(note, hit, profileName, options = {}) {
    const profile = profileName ? rhythmConfig.getProfile(profileName) : null;
    if (options !== undefined) RhythmManager_._V.assertPlainObject(options, 'applyToNote.options');
    const opts = Object.assign({}, profile || {}, options);
    return rhythmModulator.apply(note, hit, opts);
  }
}

rhythmManager = RhythmManager_;
