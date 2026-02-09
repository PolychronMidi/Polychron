// voiceModulator.js - adapter to map voice assignments to channel/note structures

voiceModulator = (function() {
  function distribute(selectedNotes, options = {}) {
    if (!Array.isArray(selectedNotes)) throw new Error('voiceModulator.distribute: selectedNotes array required');
    const opts = Object.assign({ baseVelocity: 90 }, options);
    return selectedNotes.map((n, i) => ({ note: n, channel: i, velocity: opts.baseVelocity }));
  }

  return { distribute };
})();
