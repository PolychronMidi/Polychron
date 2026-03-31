// variants/stutterTremolo.js - ultra-rapid alternation between source note
// and its octave (up or down). Tremolo/trill effect using octave intervals.

stutterVariants.register('stutterTremolo', function stutterTremolo(opts) {
  const minMidi = OCTAVE.min * 12;
  const maxMidi = OCTAVE.max * 12 - 1;
  const octUp = opts.note + 12;
  const octDown = opts.note - 12;
  const altNote = (octUp <= maxMidi) ? octUp : ((octDown >= minMidi) ? octDown : opts.note);
  if (altNote === opts.note) return stutterNotes(opts);
  const alternations = ri(15, 30);
  const stepDur = opts.sustain / alternations;
  let lastShared = opts.shared;
  for (let i = 0; i < alternations; i++) {
    const vel = clamp(m.round(opts.velocity * rf(0.55, 0.85)), 1, 127);
    lastShared = stutterNotes(Object.assign({}, opts, {
      note: i % 2 === 1 ? altNote : opts.note,
      on: opts.on + stepDur * i,
      sustain: stepDur * 0.7,
      velocity: vel, binVel: vel
    }));
  }
  return lastShared;
}, 0.5, { selfGate: 0.35, maxPerSection: 100 });
