// chordModulator.js - adapter to apply voicing/velocity adjustments to chord note objects

chordModulator = (function() {
  function apply(chordNotes, options = {}) {
    if (!Array.isArray(chordNotes)) throw new Error('chordModulator.apply: chordNotes array required');

    const opts = Object.assign({ velocityScale: 1, inversion: 0, voices: 4, baseVelocity: 100 }, options);

    // Convert to midi numbers
    let midiNotes = ChordValues.chordToMidi(chordNotes);

    // Apply inversion
    midiNotes = ChordValues.invert(midiNotes, opts.inversion);

    // Apply velocity scaling by mapping to objects
    const out = midiNotes.map(n => ({ note: n, velocity: m.max(1, m.min(127, m.round((typeof opts.baseVelocity === 'number' ? opts.baseVelocity : 100) * opts.velocityScale))) }));

    // Optionally distribute across voices
    if (opts.voices && opts.voices > 0) {
      return ChordValues.distributeAcrossVoices(out, opts.voices);
    }

    return out;
  }

  return { apply };
})();
