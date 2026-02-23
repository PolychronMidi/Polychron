// ChordManager.js - single manager hub for chord subsystem

class ChordManager {
  static listGenerators() { return ChordRegistry.list(); }

  static getGenerator(name) { return ChordRegistry.get(name); }

  static generateProgression(key, quality = 'major', type) {
    // Prefer registered 'progression' generator if present
    if (ChordRegistry.list().includes('progression')) {
      const gen = ChordRegistry.get('progression');
      return gen(key, quality, type);
    }

    // Fallback: use ProgressionGenerator directly (fail-fast if missing)
    const pg = new ProgressionGenerator(key, quality);
    return type ? pg.generate(type) : pg.random();
  }

  static applyVoicing(chordSymbolOrArray, profileName, options = {}) {
    const profile = profileName ? chordConfig.getProfile(profileName) : {};
    const opts = Object.assign({}, profile, options);

    if (typeof chordSymbolOrArray !== 'string' && !Array.isArray(chordSymbolOrArray)) {
      throw new Error('ChordManager.applyVoicing: chordSymbolOrArray must be a string or array');
    }

    const chordNames = Array.isArray(chordSymbolOrArray) ? chordSymbolOrArray : [chordSymbolOrArray];
    if (chordNames.length === 0) throw new Error('ChordManager.applyVoicing: chord list is empty');
    if (!t || !t.Chord || typeof t.Chord.get !== 'function') {
      throw new Error('ChordManager.applyVoicing: tonal chord API not available');
    }

    // Resolve to MIDI if needed and apply modulator
    const midiNotes = chordNames.map(sym => {
      if (typeof sym === 'number') return sym;

      const normalized = normalizeChordSymbol(sym);
      if (typeof normalized !== 'string' || !normalized) {
        throw new Error(`ChordManager.applyVoicing: invalid chord symbol ${String(sym)}`);
      }

      const ch = t.Chord.get(normalized);
      if (!ch || !Array.isArray(ch.notes) || ch.notes.length === 0) {
        throw new Error(`ChordManager.applyVoicing: invalid chord symbol ${normalized}`);
      }
      return ChordValues.chordToMidi(ch.notes);
    }).flat();

    if (midiNotes.length === 0) throw new Error('ChordManager.applyVoicing: no MIDI notes resolved');

    return chordModulator.apply(midiNotes, opts);
  }
}
