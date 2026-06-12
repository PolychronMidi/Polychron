// rhythmModulator.js - adapter to apply rhythm hits to note objects

rhythmModulator = (function() {
  const V = validator.create('rhythmModulator');

  function apply(note, hit, options = {}) {
    V.assertObject(note, 'note');
    V.requireDefined(hit, 'hit');

    // Convert number-like hits to boolean
    const isHit = Boolean(hit);

    if (!isHit) {
      // mark rest - leave scheduling to play pipeline
      note.rest = true;
      return note;
    }

    // Apply velocity scaling if provided
    if (options.velocityScale !== undefined) {
      V.requireType(note.velocity, 'number', 'note.velocity');
      note.velocity = m.max(0, m.min(MIDI_MAX_VALUE, m.round(note.velocity * options.velocityScale)));
    }

    // Apply timing offset (signed seconds or fraction of beat)
    if (options.timingOffset !== undefined) {
      V.requireType(note.time, 'number', 'note.time');
      note.time = note.time + options.timingOffset;
    }

    return note;
  }

  return { apply };
})();
