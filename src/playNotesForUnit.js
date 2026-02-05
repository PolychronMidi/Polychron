// playNotesForUnit.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

playNotesForUnit = function(unit = 'subdiv', opts = {}) {
  const {
    enableStutter = false,
    playProb = 0,
    stutterProb = 0
  } = opts || {};

  // Compute on and sustain
  const on = unitStart + (tpUnit * rv(rf(.2), [-.1, .07], .3));
  const shortSustain = rv(rf(Math.max(tpUnit * .5, tpUnit / unitsPerParent), (tpUnit * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
  const longSustain = rv(rf(tpUnit * .8, (tpParent * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -0.1]);
  const useShort = subdivsPerMinute > ri(400, 650);
  const sustain = (useShort ? shortSustain : longSustain) * rv(rf(.8, 1.3));
  const binVel = rv(velocity * rf(.42, .57));

  let scheduled = 0;
  crossModulateRhythms();
  const layer = LM.layers[LM.activeLayer];
  try {
    // Gate play invocation with playProb: proceed only when playProb > rf()
    if (typeof playProb === 'number' && !( playProb > rf() ) && crossModulation < rv(rf(1.8, 2.2), [-.2, -.3], .05)) {
      return trackRhythm(unit, layer, false);
    }

    if (!layer || !layer.beatMotifs) { console.warn(`${unit}.playNotesForUnit: missing layer or beatMotifs`); return trackRhythm(unit, layer, false); }
    const beatKey = Math.floor(on / tpBeat);
    const bucketIsArray = (layer && layer.beatMotifs && Array.isArray(layer.beatMotifs[beatKey]));
    const bucket = bucketIsArray ? layer.beatMotifs[beatKey] : [];

    // If there is no bucket (undefined), this is normal silence; do not warn.
    if (!bucketIsArray) return trackRhythm(unit, layer, false);

    // If we have an explicit bucket but it's empty, capture context once and warn (possible bug)
    if (!bucket.length) {
      // One-time diagnostic marker: record that an explicit empty bucket was observed
      try {
        if (!layer._emptyBucketCaptured) {
          layer._emptyBucketCaptured = true;
        }
      } catch (__) { /* defensive */ }

      console.warn(`${unit}.playNotesForUnit: empty beatMotifs bucket`);
      return trackRhythm(unit, layer, false);
    }

    const picks = MotifSpreader.getBeatMotifPicks(layer, beatKey, ri(1, 7));

    for (let pi = 0; pi < picks.length; pi++) {
      const s = picks[pi];
      if (!s || typeof s.note === 'undefined') console.warn(`${unit}.playNotesForUnit: invalid note object in motif picks`, s);

      // Source channels
      const activeSourceChannels = source.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let sci = 0; sci < activeSourceChannels.length; sci++) {
        const sourceCH = activeSourceChannels[sci];
        const isPrimary = sourceCH === cCH1;
        const onTick = isPrimary ? on + rv(tpUnit * rf(1/9), [-.1, .1], .3) : on + rv(tpUnit * rf(1/3), [-.1, .1], .3);
        const onVel = isPrimary ? velocity * rf(.95, 1.15) : binVel * rf(.95, 1.03);
        p(c, { tick: onTick, type: 'on', vals: [sourceCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? 1 : rv(rf(.92, 1.03)));
        p(c, { tick: offTick, vals: [sourceCH, s.note] }); scheduled++;

          // Schedule stutter if requested — stutter can be controlled by stutterProb or enableStutter boolean
          const stutterEnabledByProb = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow = (typeof stutterEnabledByProb === 'boolean') ? stutterEnabledByProb : (enableStutter && rf() > 0.5);
          if (shouldStutterNow) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'source', channel: sourceCH, note: s.note, on, sustain, velocity: velocity, binVel, isPrimary });
            } catch (e) { console.warn(`${unit}.playNotesForUnit: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }

      // Reflection channels
      const activeReflectionChannels = reflection.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let rci = 0; rci < activeReflectionChannels.length; rci++) {
        const reflectionCH = activeReflectionChannels[rci];
        const isPrimary = reflectionCH === cCH2;
        const onTick = isPrimary ? on + rv(tpUnit * rf(.2), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
        const onVel = isPrimary ? velocity * rf(.5, .8) : binVel * rf(.55, .9);
        p(c, { tick: onTick, type: 'on', vals: [reflectionCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? rf(.7, 1.2) : rv(rf(.65, 1.3)));
        p(c, { tick: offTick, vals: [reflectionCH, s.note] }); scheduled++;

          const stutterEnabledByProb_ref = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow_ref = (typeof stutterEnabledByProb_ref === 'boolean') ? stutterEnabledByProb_ref : (enableStutter && rf() > 0.5);
          if (shouldStutterNow_ref) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'reflection', channel: reflectionCH, note: s.note, on, sustain, velocity: velocity, binVel, isPrimary });
            } catch (e) { console.warn(`${unit}.playNotesForUnit: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }

      // Bass channels
      if (rf() < clamp(.35 * bpmRatio3, .2, .7)) {
        const activeBassChannels = bass.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
        for (let bci = 0; bci < activeBassChannels.length; bci++) {
          const bassCH = activeBassChannels[bci];
          const isPrimary = bassCH === cCH3;
          const bassNote = modClamp(s.note, 12, 35);
          const onTick = isPrimary ? on + rv(tpUnit * rf(.1), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
          const onVel = isPrimary ? velocity * rf(1.15, 1.3) : binVel * rf(1.85, 2);
          p(c, { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] }); scheduled++;
          const offTick = on + sustain * (isPrimary ? rf(1.1, 3) : rv(rf(.8, 3.5)));
          p(c, { tick: offTick, vals: [bassCH, bassNote] }); scheduled++;

          if (enableStutter && rf() > 0.5) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'bass', channel: bassCH, note: bassNote, on, sustain, velocity: velocity, binVel, isPrimary });
            } catch (e) { console.warn(`${unit}.playNotesForUnit: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }
      }
    }
    trackRhythm(unit, layer, true);
  } catch (e) {
    console.warn(`${unit}.playNotesForUnit: non-fatal error while playing notes:`, e && e.stack ? e.stack : e);
    trackRhythm(unit, layer, false);
  }

  return scheduled;
};
