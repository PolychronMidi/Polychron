// noteCascade.js - Schedule and cascade note events across units (generic helper)

// NOTE: This module follows the project's naked-global, side-effect require pattern.
// It exposes a single API: NoteCascade.playNotesAcrossUnits(opts)

/* Note: Scheduling implementation (previously `scheduleNoteCascade`) has been moved to test-only helpers in `test/setup-stage.js`.
 * The runtime API exported here is `playNotesAcrossUnits(opts)` for cross-unit note emission. For test-backed scheduling
 * StutterManager delegates to the test-provided `NoteCascade.scheduleNoteCascade` where available.
 */


/**
 * Plays notes cascading across multiple unit levels (beat → div → subdiv → subsubdiv)
 * with source/reflection/bass channel treatment and optional stutter effects.
 *
 * Universalizes the pattern from playSubdivNotes/playSubsubdivNotes:
 * - Extracts motif picks from beatMotifs
 * - Plays through source/reflection/bass channels with flipBin gating
 * - Applies timing variance based on unit level (tpBeat, tpDiv, tpSubdiv, tpSubsubdiv)
 * - Optionally schedules stutter effects per note (gated by 50/50 random)
 *
 * @param {object} [opts] - Configuration object
 * @param {string} [opts.unit] - Unit level: 'beat', 'div', 'subdiv', or 'subsubdiv'
 * @param {number} [opts.on] - Base tick for note onset
 * @param {number} [opts.sustain] - Note sustain duration
 * @param {number} [opts.velocity] - Base velocity
 * @param {number} [opts.binVel] - Binaural velocity
 * @param {boolean} [opts.enableStutter] - Whether to schedule stutter effects (50/50 gate)
 * @returns {number} Number of events scheduled
 */
function playNotesAcrossUnits(opts = {}) {
  const {
    unit = 'subdiv',
    on = 0,
    sustain = 100,
    velocity = 64,
    binVel = 32,
    enableStutter = false
  } = opts;

  // Unit-specific timing reference (fail-fast; use project globals directly)
  const tp = unit === 'beat' ? tpBeat : unit === 'div' ? tpDiv : unit === 'subdiv' ? tpSubdiv : tpSubsubdiv;

  let scheduled = 0;

  // Access layer and beatMotifs directly (fail-fast if missing)
  const layer = LM.layers[LM.activeLayer];
  const beatKey = Math.floor(on / tpBeat);
  const bucket = layer.beatMotifs[beatKey];

    // Get motif picks (fail-fast; expect MotifSpreader to exist)
    const picks = MotifSpreader.getBeatMotifPicks(layer, beatKey, ri(1, 3));

    // Use raw channel globals (fail-fast if missing)
    const sourceChannels = source;
    const reflectionChannels = reflection;
    const bassChannels = bass;

    // FlipBin gating
    const flipBinState = flipBin;
    const flipBinTrueSet = flipBinT;
    const flipBinFalseSet = flipBinF;

    // (removed helper indirection - using raw naked globals)

    // Process each motif pick
    for (let _pi = 0; _pi < picks.length; _pi++) {
      const s = picks[_pi];
      if (!s || typeof s.note === 'undefined') continue;

      // Shared stutter state for this note (all channels share same stutter events)
      const stutterState = { stutters: new Map(), shifts: new Map(), global: {} };

      // Determine if stutter is enabled for this note (50/50 gate)
      const shouldStutter = enableStutter && rf() > 0.5;

      // ===== SOURCE CHANNELS =====
      const activeSourceChannels = sourceChannels.filter(ch =>
        flipBinState ? flipBinTrueSet.includes(ch) : flipBinFalseSet.includes(ch)
      );

      for (let sci = 0; sci < activeSourceChannels.length; sci++) {
        const sourceCH = activeSourceChannels[sci];
        const isPrimary = sourceCH === cCH1;

        // Note on event
        const onTick = isPrimary
          ? on + rv(tp * rf(1/9), [-.1, .1], .3)
          : on + rv(tp * rf(1/3), [-.1, .1], .3);
        const onVel = isPrimary
          ? velocity * rf(.95, 1.15)
          : binVel * rf(.95, 1.03);

        p(c, { tick: onTick, type: 'on', vals: [sourceCH, s.note, onVel] });
        scheduled++;

        // Note off event
        const offTick = on + sustain * (isPrimary ? 1 : rv(rf(.92, 1.03)));
        p(c, { tick: offTick, vals: [sourceCH, s.note] });
        scheduled++;

        // Schedule stutter if enabled (use test-provided NoteCascade scheduler)
        if (shouldStutter) {
          if (typeof NoteCascade === 'undefined' || !NoteCascade || typeof NoteCascade.scheduleNoteCascade !== 'function') {
            throw new Error('playNotesAcrossUnits: NoteCascade.scheduleNoteCascade is not available; scheduling must be provided by tests');
          }
          NoteCascade.scheduleNoteCascade(Stutter, {
            profile: 'source',
            channel: sourceCH,
            note: s.note,
            on,
            sustain,
            velocity,
            binVel,
            isPrimary,
            shared: stutterState
          });
        }
      }

      // ===== REFLECTION CHANNELS =====
      const activeReflectionChannels = reflectionChannels.filter(ch =>
        flipBinState ? flipBinTrueSet.includes(ch) : flipBinFalseSet.includes(ch)
      );

      for (let rci = 0; rci < activeReflectionChannels.length; rci++) {
        const reflectionCH = activeReflectionChannels[rci];
        const isPrimary = reflectionCH === cCH2;

        // Note on event
        const onTick = isPrimary
          ? on + rv(tp * rf(.2), [-.01, .1], .5)
          : on + rv(tp * rf(1/3), [-.01, .1], .5);
        const onVel = isPrimary
          ? velocity * rf(.5, .8)
          : binVel * rf(.55, .9);

        p(c, { tick: onTick, type: 'on', vals: [reflectionCH, s.note, onVel] });
        scheduled++;

        // Note off event
        const offTick = on + sustain * (isPrimary ? rf(.7, 1.2) : rv(rf(.65, 1.3)));
        p(c, { tick: offTick, vals: [reflectionCH, s.note] });
        scheduled++;

        // Schedule stutter if enabled (use test-provided NoteCascade scheduler)
        if (shouldStutter) {
          if (typeof NoteCascade === 'undefined' || !NoteCascade || typeof NoteCascade.scheduleNoteCascade !== 'function') {
            throw new Error('playNotesAcrossUnits: NoteCascade.scheduleNoteCascade is not available; scheduling must be provided by tests');
          }
          NoteCascade.scheduleNoteCascade(Stutter, {
            profile: 'reflection',
            channel: reflectionCH,
            note: s.note,
            on,
            sustain,
            velocity,
            binVel,
            isPrimary,
            shared: stutterState
          });
        }
      }

      // ===== BASS CHANNELS (with BPM-based probability) =====
      if (rf() < clamp(.35 * bpmRatio3, .2, .7)) {
        const activeBassChannels = bassChannels.filter(ch =>
          flipBinState ? flipBinTrueSet.includes(ch) : flipBinFalseSet.includes(ch)
        );

        for (let bci = 0; bci < activeBassChannels.length; bci++) {
          const bassCH = activeBassChannels[bci];
          const isPrimary = bassCH === cCH3;
          const bassNote = modClamp(s.note, 12, 35);

          // Note on event
          const onTick = isPrimary
            ? on + rv(tp * rf(.1), [-.01, .1], .5)
            : on + rv(tp * rf(1/3), [-.01, .1], .5);
          const onVel = isPrimary
            ? velocity * rf(1.15, 1.3)
            : binVel * rf(1.85, 2);

          p(c, { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] });
          scheduled++;

          // Note off event
          const offTick = on + sustain * (isPrimary ? rf(1.1, 3) : rv(rf(.8, 3.5)));
          p(c, { tick: offTick, vals: [bassCH, bassNote] });
          scheduled++;

          // Schedule stutter if enabled (use test-provided NoteCascade scheduler)
          if (shouldStutter) {
            if (typeof NoteCascade === 'undefined' || !NoteCascade || typeof NoteCascade.scheduleNoteCascade !== 'function') {
              throw new Error('playNotesAcrossUnits: NoteCascade.scheduleNoteCascade is not available; scheduling must be provided by tests');
            }
            NoteCascade.scheduleNoteCascade(Stutter, {
              profile: 'bass',
              channel: bassCH,
              note: bassNote,
              on,
              sustain,
              velocity,
              binVel,
              isPrimary,
              shared: stutterState
            });
          }
        }
      }
    }

  return scheduled;
}

// Export as naked global
NoteCascade = { playNotesAcrossUnits };
