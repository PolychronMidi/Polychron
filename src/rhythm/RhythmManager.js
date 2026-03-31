// RhythmManager.js - single manager hub for rhythm subsystem

RhythmManager = class RhythmManager {
  /** @type {ValidatorInstance} */
  static V;
  static { this.V = validator.create('RhythmManager'); }
  static listGenerators() { return rhythmRegistry.list(); }

  static getGenerator(name) { return rhythmRegistry.get(name); }

  static getPattern(level, length, pattern, method, ...args) {
    if (method) {
      const fn = rhythmRegistry.get(method);
      return fn(...args);
    }

    // fallback behavior: use existing getRhythm logic via globals - but fail fast if no candidate
    const p = getRhythm(level, length, pattern, method, ...args);
    if (!p) throw new Error('RhythmManager.getPattern: getRhythm returned falsy pattern');
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
    if (options !== undefined) RhythmManager.V.assertPlainObject(options, 'applyToNote.options');
    if (profileName) {
      const profile = rhythmConfig.getProfile(profileName);
      RhythmManager.V.assertPlainObject(profile, 'rhythmConfig.getProfile(' + profileName + ')');
      return rhythmModulator.apply(note, hit, Object.assign({}, profile, options));
    }
    const opts = Object.assign({}, options);
    return rhythmModulator.apply(note, hit, opts);
  }
}
