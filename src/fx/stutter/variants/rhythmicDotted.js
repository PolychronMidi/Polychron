// variants/rhythmicDotted.js - echoes at dotted-note intervals (1.5x grid).
// Creates swing/dotted rhythm feel from stutter alone.

stutterVariants.register('rhythmicDotted', function rhythmicDotted(opts) {
  const gridSize = spBeat / ri(3, 6);
  const dottedGrid = gridSize * 1.5;
  const echoCount = ri(2, 5);
  let lastShared = opts.shared;
  for (let i = 1; i <= echoCount; i++) {
    const echoTime = opts.on + dottedGrid * i;
    if (echoTime >= opts.on + opts.sustain * 1.8) break;
    lastShared = stutterNotes(Object.assign({}, opts, {
      on: echoTime,
      sustain: gridSize * 0.55,
      velocity: m.round(opts.velocity * rf(0.5, 0.8))
    }));
  }
  return lastShared;
}, 1.0, { selfGate: 0.8, maxPerSection: 170 });
