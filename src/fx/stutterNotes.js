// stutterNotes.js - per-note stutter and octave-shift helper

stutterNotes = (opts = {}) => {
  try {
    const {
      profile = 'source',
      channel,
      note,
      on,
      sustain,
      velocity,
      binVel,
      isPrimary = false,
      shared
    } = opts;

    if (typeof channel === 'undefined' || typeof note !== 'number') return;

    const stutters = shared?.stutters || (shared ? (shared.stutters = new Map()) : new Map());
    const shifts = shared?.shifts || (shared ? (shared.shifts = new Map()) : new Map());
    const globalState = shared?.global || (shared ? (shared.global = {}) : {});

    const isSource = profile === 'source';
    const isReflection = profile === 'reflection';
    const isBass = profile === 'bass';

    const clampNote = (n) => {
      if (isBass) return modClamp(n, 0, 59);
      return modClamp(n, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
    };

    const velScale = (primaryRange, otherRange) => {
      return isPrimary ? velocity * rf(primaryRange[0], primaryRange[1]) : binVel * rf(otherRange[0], otherRange[1]);
    };

    // Source: optional global stutter plan shared across channels
    if (isSource && !globalState.applied && rf() < rv(.2, [.5, 1], .3)) {
      const numStutters = m.round(rv(rv(ri(3, 9), [2, 5], .33), [2, 5], .1));
      globalState.applied = true;
      globalState.data = {
        numStutters,
        duration: rf(.9, 1.1) * sustain / numStutters,
        minVelocity: 11,
        maxVelocity: 100,
        isFadeIn: rf() < 0.5,
        decay: rf(.75, 1.25)
      };
    }

    if (isSource && globalState.data) {
      const { numStutters, duration, minVelocity, maxVelocity, isFadeIn, decay } = globalState.data;
      for (let i = 0; i < numStutters; i++) {
        const tick = on + duration * i;
        let stutterNote = note;
        if (rf() < .25) {
          if (!shifts.has(channel)) shifts.set(channel, ri(-3, 3) * 12);
          stutterNote = clampNote(note + shifts.get(channel));
        }

        let currentVelocity;
        if (isFadeIn) {
          const fadeInMultiplier = decay * (i / (numStutters * rf(0.4, 2.2) - 1));
          currentVelocity = clamp(m.min(maxVelocity, ri(33) + maxVelocity * fadeInMultiplier), 0, 100);
        } else {
          const fadeOutMultiplier = 1 - (decay * (i / (numStutters * rf(0.4, 2.2) - 1)));
          currentVelocity = clamp(m.max(0, ri(33) + maxVelocity * fadeOutMultiplier), 0, 100);
        }

        p(c, { tick: tick + duration * rf(.15, .6), type: 'on', vals: [channel, stutterNote, isPrimary ? currentVelocity * rf(.3, .7) : currentVelocity * rf(.45, .8)] });
        p(c, { tick: Math.max(tick, tick - duration * rf(.15)), vals: [channel, stutterNote] });
      }
      p(c, { tick: on + sustain * rf(.5, 1.5), vals: [channel, note] });
    }

    // Per-channel stutter (source/reflection/bass)
    const perProb = isSource ? rv(.07, [.5, 1], .2) : (isReflection ? .2 : .7);
    if (rf() < perProb) {
      if (!stutters.has(channel)) {
        if (isSource) stutters.set(channel, m.round(rv(rv(ri(2, 7), [2, 5], .33), [2, 5], .1)));
        else if (isReflection) stutters.set(channel, m.round(rv(rv(ri(2, 7), [2, 5], .33), [2, 5], .1)));
        else stutters.set(channel, m.round(rv(rv(ri(2, 5), [2, 3], .33), [2, 10], .1)));
      }

      const numStutters = stutters.get(channel);
      const duration = .25 * ri(1, isSource ? 5 : 8) * sustain / numStutters;
      const shiftProb = isSource ? .15 : (isReflection ? .7 : .5);
      const shiftRange = isBass ? 2 : 3;
      const fireProb = isSource ? .6 : (isReflection ? .5 : .3);
      const velRanges = isSource
        ? (isPrimary ? [0.3, 0.7] : [0.45, 0.8])
        : (isReflection ? (isPrimary ? [0.25, 0.65] : [0.4, 0.75]) : (isPrimary ? [0.55, 0.85] : [0.75, 1.05]));

      for (let i = 0; i < numStutters; i++) {
        const tick = on + duration * i;
        let stutterNote = note;
        if (rf() < shiftProb) {
          if (!shifts.has(channel)) shifts.set(channel, ri(-shiftRange, shiftRange) * 12);
          stutterNote = clampNote(note + shifts.get(channel));
        }
        if (rf() < fireProb) {
          p(c, { tick: tick - duration * rf(.15, .3), vals: [channel, stutterNote] });
          p(c, { tick: tick + duration * rf(.15, .7), type: 'on', vals: [channel, stutterNote, (isPrimary ? velocity : binVel) * rf(velRanges[0], velRanges[1])] });
        }
      }

      if (isSource) p(c, { tick: on + sustain * rf(.5, 1.5), vals: [channel, note] });
    }
  } catch (e) { /* swallow */ }
}
