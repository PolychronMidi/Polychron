// variants/alienArpeggio.js - arpeggios through xenolinguistic interval sets.
// Dissonance level selects the interval grammar: alien cluster (m2+tritone+m7)
// at high dissonance, suspended approach (P4+m3+m6) at low dissonance.
// The sequence traverses harmonic territory with internal consistency,
// creating a foreign-musical-system feel.

moduleLifecycle.declare({
  name: 'alienArpeggioVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  lazyDeps: ['emergentMelodicEngine', 'harmonicIntervalGuard', 'stutterShift'],
  provides: ['alienArpeggioVariant'],
  init: (deps) => {
    const stutterVariants = deps.stutterVariants;
    stutterVariants.register('alienArpeggio', function alienArpeggio(opts) {
      const dissonance = harmonicIntervalGuard.getDissonanceLevel();
      // Alien cluster: m2(1) + tritone(6) + m7(10) -- atonal, extraterrestrial
      // Suspended approach: P4(5) + m3(3) + m6(8) -- floating, modal, ambiguous
      const intervals = dissonance > 0.52
        ? [1, 6, 10, 6, 1]
        : [5, 3, 8, 3, 5];
      const noteCount = ri(2, m.min(4, intervals.length - 1));
      // Dissonant mode ascends more (reaching out), consonant mode descends more (settling)
      // R54: melodic contour shape further modulates ascend bias via emergentMelodicEngine
      const baseAscendBias = dissonance > 0.52 ? 0.68 : 0.42;
      const ascendBias = /** @type {number} */ (emergentMelodicEngine.getContourAscendBias(baseAscendBias));
      let currentNote = opts.note;
      let lastShared = opts.shared;
      for (let i = 0; i < noteCount; i++) {
        const dir = rf() < ascendBias ? 1 : -1;
        currentNote = stutterShift.shift(currentNote, intervals[i] * dir);
        const velScale = rf(0.42, 0.76) * (1 - i * 0.09);
        const vel = clamp(m.round(opts.velocity * velScale), 1, 127);
        lastShared = stutterNotes(Object.assign({}, opts, {
          note: currentNote,
          on: opts.on + opts.sustain * rf(0.07, 0.19) * (i + 1),
          sustain: opts.sustain * rf(0.28, 0.55),
          velocity: vel, binVel: vel
        }));
      }
      return lastShared;
    }, 1.1, { selfGate: 0.92, maxPerSection: 190 });
    return { registered: true };
  },
});
