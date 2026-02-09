// playNotes.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

playNotes = function(unit = 'subdiv', opts = {}) {
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
  velocity = rl(velocity,-3,3,95,105);
  const binVel = rv(velocity * rf(.4, .9));

  let scheduled = 0;
  crossModulateRhythms();
  const layer = LM.layers[LM.activeLayer];

  // Apply subtle noise modulation to base velocity for organic variation
  const noiseProfile = getNoiseProfile('subtle');
  const currentTime = beatStart + tpUnit * 0.5; // Approximate time within the unit
  const voiceIdSeed = beatStart * 73 + layer.id * 43; // Deterministic voice ID from context
  try {
    // Gate play invocation with playProb and crossModulation
    if (typeof playProb === 'number' && (rf() > playProb) && (crossModulation < rv(rf(2, 4), [-.2, -.3], .05))) {
      return trackRhythm(unit, layer, false);
    }

    // Delegate motif selection and transformation to playMotifs
    const picks = playMotifs(unit, layer);

    for (let pi = 0; pi < picks.length; pi++) {
      const s = picks[pi];
      if (!s || typeof s.note === 'undefined') console.warn(`${unit}.playNotes: invalid note object in motif picks`, s);

      // Source channels
      const activeSourceChannels = source.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let sci = 0; sci < activeSourceChannels.length; sci++) {
        const sourceCH = activeSourceChannels[sci];
        const isPrimary = sourceCH === cCH1;
        const onTick = isPrimary ? on + rv(tpUnit * rf(1/9), [-.1, .1], .3) : on + rv(tpUnit * rf(1/3), [-.1, .1], .3);
        const baseOnVel = isPrimary ? velocity * rf(.95, 1.15) : binVel * rf(.75, 1.03);
        const onVel = applyNoiseToVelocity(baseOnVel, sourceCH, currentTime, 'subtle');
        p(c, { tick: onTick, type: 'on', vals: [sourceCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? 1 : rv(rf(.92, 1.03)));
        p(c, { tick: offTick, vals: [sourceCH, s.note] }); scheduled++;

          // Schedule stutter if requested — stutter can be controlled by stutterProb or enableStutter boolean
          const stutterEnabledByProb = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow = (typeof stutterEnabledByProb === 'boolean') ? stutterEnabledByProb : (enableStutter && rf() > 0.5);
          if (shouldStutterNow) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'source', channel: sourceCH, note: s.note, on, sustain, velocity, binVel, isPrimary });
              scheduleStutterNotesFromDensity('source', sourceCH, s.note, onVel, onTick, sustain, stutterProb);
            } catch (e) { console.warn(`${unit}.playNotes: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }

      // Reflection channels
      const activeReflectionChannels = reflection.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let rci = 0; rci < activeReflectionChannels.length; rci++) {
        const reflectionCH = activeReflectionChannels[rci];
        const isPrimary = reflectionCH === cCH2;
        const onTick = isPrimary ? on + rv(tpUnit * rf(.2), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
        const baseOnVel = isPrimary ? velocity * rf(.7, 1.2) : binVel * rf(.55, 1.1);
        const onVel = applyNoiseToVelocity(baseOnVel, reflectionCH, currentTime, 'subtle');
        p(c, { tick: onTick, type: 'on', vals: [reflectionCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? rf(.7, 1.2) : rv(rf(.65, 1.3)));
        p(c, { tick: offTick, vals: [reflectionCH, s.note] }); scheduled++;

          const stutterEnabledByProb_ref = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow_ref = (typeof stutterEnabledByProb_ref === 'boolean') ? stutterEnabledByProb_ref : (enableStutter && rf() > 0.5);
          if (shouldStutterNow_ref) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'reflection', channel: reflectionCH, note: s.note, on, sustain, velocity, binVel, isPrimary });
              scheduleStutterNotesFromDensity('reflection', reflectionCH, s.note, onVel, onTick, sustain, stutterProb);
            } catch (e) { console.warn(`${unit}.playNotes: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }

      // Bass channels
      if (rf() < clamp(.75 * bpmRatio3, .2, .7)) {
        const activeBassChannels = bass.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
        for (let bci = 0; bci < activeBassChannels.length; bci++) {
          const bassCH = activeBassChannels[bci];
          const isPrimary = bassCH === cCH3;
          const bassNote = modClamp(s.note, m.max(0, OCTAVE.min * 12 - 1), 59);
          const onTick = isPrimary ? on + rv(tpUnit * rf(.1), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
          const onVel = isPrimary ? velocity * rf(1.15, 1.5) : binVel * rf(1.85, 2.5);
          p(c, { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] }); scheduled++;
          const offTick = on + sustain * (isPrimary ? rf(1.1, 3) : rv(rf(.8, 3.5)));
          p(c, { tick: offTick, vals: [bassCH, bassNote] }); scheduled++;

          if (enableStutter && rf() > 0.5) {
            try {
              Stutter.scheduleStutterForUnit({ profile: 'bass', channel: bassCH, note: bassNote, on, sustain, velocity, binVel, isPrimary });
              scheduleStutterNotesFromDensity('bass', bassCH, bassNote, onVel, onTick, sustain, stutterProb);
            } catch (e) { console.warn(`${unit}.playNotes: Stutter.scheduleStutterForUnit failed`, e && e.stack ? e.stack : e);
            }
          }
        }
      }
    }
    trackRhythm(unit, layer, true);
  } catch (e) {
    console.warn(`${unit}.playNotes: non-fatal error while playing notes:`, e && e.stack ? e.stack : e);
    trackRhythm(unit, layer, false);
  }

  return scheduled;
};
