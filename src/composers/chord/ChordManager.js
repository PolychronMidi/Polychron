// ChordManager.js - single manager hub for chord subsystem

ChordManager = (function() {
  const registry = ChordRegistry;
  const values = ChordValues;
  const mod = chordModulator;
  const config = chordConfig;

  function listGenerators() { return registry.list(); }

  function getGenerator(name) { return registry.get(name); }

  function generateProgression(key, quality = 'major', type) {
    // Prefer registered 'progression' generator if present
    if (registry.list().includes('progression')) {
      const gen = registry.get('progression');
      return gen(key, quality, type);
    }

    // Fallback: use ProgressionGenerator directly (fail-fast if missing)
    const pg = new ProgressionGenerator(key, quality);
    return type ? pg.generate(type) : pg.random();
  }

  function applyVoicing(chordSymbolOrArray, profileName, options = {}) {
    const profile = profileName ? config.getProfile(profileName) : {};
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
      return values.chordToMidi(ch.notes);
    }).flat();

    if (midiNotes.length === 0) throw new Error('ChordManager.applyVoicing: no MIDI notes resolved');

    return mod.apply(midiNotes, opts);
  }

  return { listGenerators, getGenerator, generateProgression, applyVoicing };
})();
