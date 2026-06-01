// motifModulator.js - adapter to apply motif attributes to note objects

motifModulator = (function() {
  function apply(notes, motifPattern, options = {}) {
    if (!Array.isArray(notes)) throw new Error('motifModulator.apply: notes array required');
    if (!Array.isArray(motifPattern)) throw new Error('motifModulator.apply: motifPattern array required');

    const opts = Object.assign({ velocityScale: 1, timingOffset: 0 }, options);

    // Apply motif pattern to notes (simple mapping by index)
    return notes.map((note, i) => {
      let pat = motifPattern[i % motifPattern.length];
      if (typeof pat === 'undefined') {
        pat = {};
      } else if (pat !== null && typeof pat !== 'object') {
        throw new Error('motifModulator.apply: motifPattern entries must be objects');
      }
      const out = Object.assign({}, note);
      if (pat.velocity !== undefined && (typeof pat.velocity !== 'number' || !Number.isFinite(pat.velocity))) {
        throw new Error(`motifModulator.apply: invalid velocity at index ${i}`);
      }
      if (pat.time !== undefined && (typeof pat.time !== 'number' || !Number.isFinite(pat.time))) {
        throw new Error(`motifModulator.apply: invalid time at index ${i}`);
      }
      if (pat.duration !== undefined && (typeof pat.duration !== 'number' || !Number.isFinite(pat.duration) || pat.duration <= 0)) {
        throw new Error(`motifModulator.apply: invalid duration at index ${i}`);
      }
      if (pat.velocity !== undefined) out.velocity = m.max(1, m.min(127, m.round((typeof out.velocity === 'number' ? out.velocity : 100) * (pat.velocity * opts.velocityScale))));
      if (pat.time !== undefined) out.time = (typeof out.time === 'number' ? out.time : 0) + pat.time + opts.timingOffset;
      if (pat.duration !== undefined) out.duration = pat.duration;
      return out;
    });
  }

  return { apply };
})();
