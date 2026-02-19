// rhythmModulator.js - adapter to apply rhythm hits to note objects

rhythmModulator = (function() {
  function apply(note, hit, options = {}) {
    if (typeof note !== 'object' || note === null) throw new Error('rhythmModulator.apply: note object required');
    if (typeof hit !== 'boolean' && typeof hit !== 'number') throw new Error('rhythmModulator.apply: hit must be boolean or number');

    // Convert number-like hits to boolean
    const isHit = Boolean(hit);

    if (!isHit) {
      // mark rest - leave scheduling to play pipeline
      note.rest = true;
      return note;
    }

    // Apply velocity scaling if provided
    if (options.velocityScale !== undefined) {
      if (typeof note.velocity !== 'number') throw new Error('rhythmModulator.apply: note.velocity missing for velocityScale');
      note.velocity = m.max(0, m.min(MIDI_MAX_VALUE, m.round(note.velocity * options.velocityScale)));
    }

    // Apply timing offset (signed seconds or fraction of beat)
    if (options.timingOffset !== undefined) {
      if (typeof note.time !== 'number') throw new Error('rhythmModulator.apply: note.time missing for timingOffset');
      note.time = note.time + options.timingOffset;
    }

    return note;
  }

  return { apply };
})();
