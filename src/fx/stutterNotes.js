// stutterNotes.js - per-note stutter and octave-shift helper

/**
 * @typedef {Object} StutterShared
 * @property {Map} stutters
 * @property {Map} shifts
 * @property {Object} global
 */

// Module-scope helpers to avoid hot-path allocations
const _clampStutterNote = (n, isBassLocal) => {
  if (isBassLocal) return modClamp(n, m.max(0, OCTAVE.min * 12 - 1), 59);
  return modClamp(n, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
};

const _velScale = (isPrimaryLocal, velocityLocal, binVelLocal, primaryRange, otherRange, rf) => {
  return isPrimaryLocal ? velocityLocal * rf(primaryRange[0], primaryRange[1]) : binVelLocal * rf(otherRange[0], otherRange[1]);
};

/**
 * stutterNotes: apply per-note stutter/shift effects.
 * Accepts injected RNG helpers (`rf`, `ri`) and returns the `shared` object for testing convenience.
 * @param {Object} opts
 * @param {string} [opts.profile='source']
 * @param {string|number} opts.channel
 * @param {number} opts.note
 * @param {number} opts.on
 * @param {number} opts.sustain
 * @param {number} opts.velocity
 * @param {number} opts.binVel
 * @param {boolean} [opts.isPrimary=false]
 * @param {StutterShared|any} [opts.shared]
 * @param {function} [opts.rf] - optional RNG float generator overriding global `rf`
 * @param {function} [opts.ri] - optional RNG int generator overriding global `ri`
 * @param {boolean} [opts.emit=true] - if false, do not call `p()`; instead return planned events
 * @returns {StutterShared|{shared:StutterShared,events:any[]}}
 */
stutterNotes = (/** @type {any} */ opts = {}) => {
    const {
      profile = 'source',
      channel,
      note,
      on,
      sustain,
      velocity,
      binVel,
      isPrimary = false,
      shared = null,
      emit = true // when false, do not call p(); instead return planned events
    } = opts;

    if (typeof channel === 'undefined' || typeof note !== 'number') throw new Error('stutterNotes: missing channel or numeric note');

    // Collect planned events when emit === false
    const plannedEvents = [];

    // Ensure shared shape exists and is attached to caller when provided
    let localShared = shared;
    if (!localShared) {
      localShared = { stutters: new Map(), shifts: new Map(), global: {} };
    }
    if (!localShared.stutters) localShared.stutters = new Map();
    if (!localShared.shifts) localShared.shifts = new Map();
    if (!localShared.global) localShared.global = {};

    const stutters = localShared.stutters;
    const shifts = localShared.shifts;
    const globalState = localShared.global;

    // Reset per-channel octave shifts when the beat index changes
    const currentBeatIndex = (typeof beatIndex !== 'undefined') ? beatIndex : null;
    if (globalState._lastBeatIndex !== currentBeatIndex) {
      shifts.clear();
      globalState._lastBeatIndex = currentBeatIndex;
    }

    const isSource = profile === 'source';
    const isReflection = profile === 'reflection';
    const isBass = profile === 'bass';

    // Get profile-specific config from centralized StutterConfig
    const profileCfg = (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.getProfileConfig === 'function')
      ? StutterConfig.getProfileConfig(profile)
      : { perProb: 0.2, shiftProb: 0.5 }; // Fallback if config unavailable

    // Local wrapper uses module-scope helper for performance; falls back to injected modClamp if provided
    const clampStutterNote = (n) => {
      if (typeof modClamp === 'function') {
        if (isBass) return modClamp(n, m.max(0, OCTAVE.min * 12 - 1), 59);
        return modClamp(n, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
      }
      return _clampStutterNote(n, isBass);
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
          stutterNote = _clampStutterNote(note + shifts.get(channel), isBass);
        }

        let currentVelocity;
        if (isFadeIn) {
          const fadeInMultiplier = decay * (i / (numStutters * rf(0.4, 2.2) - 1));
          currentVelocity = clamp(minVelocity + (maxVelocity - minVelocity) * fadeInMultiplier, 0, 127);
        } else {
          const fadeOutMultiplier = 1 - (decay * (i / (numStutters * rf(0.4, 2.2) - 1)));
          currentVelocity = clamp(minVelocity + (maxVelocity - minVelocity) * fadeOutMultiplier, 0, 127);
        }

        const ev1 = { tick: tick + duration * rf(.15, .6), type: 'on', vals: [channel, stutterNote, isPrimary ? currentVelocity * rf(.3, .7) : currentVelocity * rf(.45, .8)] };
        const ev2 = { tick: Math.max(tick, tick - duration * rf(.15)), vals: [channel, stutterNote] };
        if (emit === false) { plannedEvents.push(ev1); plannedEvents.push(ev2); } else { p(c, ev1); p(c, ev2); }
      }
        const evFinal = { tick: on + sustain * rf(.5, 1.5), vals: [channel, note] };
        if (emit === false) plannedEvents.push(evFinal); else p(c, evFinal);
    }

    // Per-channel stutter (source/reflection/bass)
    const perProb = isSource ? rv(profileCfg.perProb, [.5, 1], .2) : profileCfg.perProb;
    if (rf() < perProb) {
      if (!stutters.has(channel)) {
        if (isSource) stutters.set(channel, m.round(rv(rv(ri(2, 7), [2, 5], .33), [2, 5], .1)));
        else if (isReflection) stutters.set(channel, m.round(rv(rv(ri(2, 7), [2, 5], .33), [2, 5], .1)));
        else stutters.set(channel, m.round(rv(rv(ri(2, 5), [2, 3], .33), [2, 10], .1)));
      }

      const numStutters = stutters.get(channel);
      const duration = .25 * ri(1, isSource ? 5 : 8) * sustain / numStutters;
      const shiftProb = profileCfg.shiftProb;
      const shiftRange = isBass ? 2 : 3;
      const fireProb = isSource ? .6 : (isReflection ? .5 : .3);
      const velRanges = (typeof StutterConfig !== 'undefined' && StutterConfig && StutterConfig.getVelocityRange)
        ? StutterConfig.getVelocityRange(profile, isPrimary)
        : (isSource
          ? (isPrimary ? [0.3, 0.7] : [0.45, 0.8])
          : (isReflection ? (isPrimary ? [0.25, 0.65] : [0.4, 0.75]) : (isPrimary ? [0.55, 0.85] : [0.75, 1.05])));

      for (let i = 0; i < numStutters; i++) {
        const tick = on + duration * i;
        let stutterNote = note;
        if (rf() < shiftProb) {
          if (!shifts.has(channel)) shifts.set(channel, ri(-shiftRange, shiftRange) * 12);
          stutterNote = clampStutterNote(note + shifts.get(channel));
        }
        if (rf() < fireProb) {
          const evA = { tick: tick - duration * rf(.15, .3), vals: [channel, stutterNote] };
          const evB = { tick: tick + duration * rf(.15, .7), type: 'on', vals: [channel, stutterNote, (isPrimary ? velocity : binVel) * rf(velRanges[0], velRanges[1])] };
          if (emit === false) { plannedEvents.push(evA); plannedEvents.push(evB); } else { p(c, evA); p(c, evB); }
        }
      }

      const evEnd = { tick: on + sustain * rf(.5, 1.5), vals: [channel, note] };
      if (emit === false) plannedEvents.push(evEnd); else { if (isSource) p(c, evEnd); }
    }

    return emit === false ? { shared: localShared, events: plannedEvents } : localShared;
};

var StutterConfig;
// Register helper with stutterConfig so manager can detect the original implementation
try {
  // @ts-ignore: runtime-only naked global registration
  if (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.registerHelper === 'function') {
    // @ts-ignore: runtime-only naked global registration
    StutterConfig.registerHelper(stutterNotes);
  }
} catch (e) { /* ignore if module not present */ }
