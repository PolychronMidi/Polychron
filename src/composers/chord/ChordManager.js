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
    if (typeof ProgressionGenerator !== 'function') throw new Error('ChordManager.generateProgression: ProgressionGenerator not available');
    const pg = new ProgressionGenerator(key, quality);
    return type ? pg.generate(type) : pg.random();
  }

  function applyVoicing(chordSymbolOrArray, profileName, options = {}) {
    const profile = profileName ? config.getProfile(profileName) : {};
    const opts = Object.assign({}, profile, options);

    const chordNames = Array.isArray(chordSymbolOrArray) ? chordSymbolOrArray : (typeof chordSymbolOrArray === 'string' ? [chordSymbolOrArray] : []);

    // Resolve to MIDI if needed and apply modulator
    const midiNotes = chordNames.map(sym => {
      if (typeof sym === 'number') return sym;
      const ch = t.Chord.get(sym);
      if (!ch || !Array.isArray(ch.notes) || ch.notes.length === 0) throw new Error(`ChordManager.applyVoicing: invalid chord symbol ${sym}`);
      return ch.notes.map(n => getMidiValue ? getMidiValue(n) : null).flat();
    }).flat();

    return mod.apply(midiNotes, opts);
  }

  return { listGenerators, getGenerator, generateProgression, applyVoicing };
})();
