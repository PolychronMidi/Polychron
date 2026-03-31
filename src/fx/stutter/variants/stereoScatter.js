// variants/stereoScatter.js - echoes distributed across L/R channels.
// During flipBinCrossfade window: aggressive smudge to blur detune artifacts.
// Outside crossfade: subtle widening with occasional ghost-quiet opposite-side echoes.

stutterVariants.register('stereoScatter', function stereoScatter(opts) {
  const allChs = source.concat(reflection);
  if (allChs.length === 0) return stutterNotes(opts);

  // Check if this note's absolute time falls within the crossfade window
  const inCrossfade = opts.on >= flipBinCrossfadeWindow[0]
    && opts.on <= flipBinCrossfadeWindow[1];

  let lastShared = opts.shared;
  if (inCrossfade) {
    // Aggressive smudge: more echoes, wider channel spread
    const echoCount = ri(4, 6);
    for (let i = 0; i < echoCount; i++) {
      const ch = allChs[i % allChs.length];
      const vel = clamp(m.round(opts.velocity * rf(0.35, 0.55)), 1, 127);
      lastShared = stutterNotes(Object.assign({}, opts, {
        channel: ch,
        on: opts.on + opts.sustain * 0.06 * i,
        sustain: opts.sustain * rf(0.12, 0.25),
        velocity: vel, binVel: vel
      }));
    }
  } else {
    // Subtle widening: 1-2 ghost-quiet echoes on opposite-side channels
    const oppositeChs = flipBin ? flipBinF3 : flipBinT3;
    if (oppositeChs.length === 0) return stutterNotes(opts);
    const echoCount = ri(1, 2);
    for (let i = 0; i < echoCount; i++) {
      const ch = oppositeChs[ri(oppositeChs.length - 1)];
      const vel = clamp(ri(12, 25), 1, 127);
      lastShared = stutterNotes(Object.assign({}, opts, {
        channel: ch,
        on: opts.on + opts.sustain * rf(0.05, 0.2),
        sustain: opts.sustain * rf(0.2, 0.4),
        velocity: vel, binVel: vel
      }));
    }
  }
  return lastShared;
}, 0.8, { selfGate: 0.8, maxPerSection: 200 });
