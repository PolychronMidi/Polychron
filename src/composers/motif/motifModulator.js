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
      if (pat.velocity !== undefined) out.velocity = Math.max(1, Math.min(127, Math.round((typeof out.velocity === 'number' ? out.velocity : 100) * (pat.velocity * opts.velocityScale))));
      if (pat.time !== undefined) out.time = (typeof out.time === 'number' ? out.time : 0) + pat.time + opts.timingOffset;
      if (pat.duration !== undefined) out.duration = pat.duration;
      return out;
    });
  }

  return { apply };
})();
