// playNotesForUnit.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to `noteCascade.scheduleNoteCascade` when available.

playNotesForUnit = function(unit = 'subdiv', opts = {}) {
  const {
    on: providedOn,
    sustain: providedSustain,
    velocity: providedVelocity = velocity,
    binVel: providedBinVel,
    enableStutter = false,
    playProb = 0,
    stutterProb = 0
  } = opts || {};

  // Timing base per unit
  const tp = unit === 'beat' ? tpBeat : unit === 'div' ? tpDiv : unit === 'subdiv' ? tpSubdiv : tpSubsubdiv;
  const baseStart = typeof providedOn !== 'undefined' ? providedOn : (unit === 'subdiv' ? subdivStart : unit === 'subsubdiv' ? subsubdivStart : unit === 'div' ? divStart : beatStart);

  // Compute on and sustain (mirrors stage.js formulas)
  const on = baseStart + (tp * rv(rf(.2), [-.1, .07], .3));
  const shortSustain = rv(rf(Math.max(tpDiv * .5, tpDiv / subdivsPerDiv), (tpBeat * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
  const longSustain = rv(rf(tpDiv * .8, (tpBeat * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -0.1]);
  const useShort = subdivsPerMinute > ri(400, 650);
  const sustain = typeof providedSustain !== 'undefined' ? providedSustain : (useShort ? shortSustain : longSustain) * rv(rf(.8, 1.3));
  const binVel = typeof providedBinVel !== 'undefined' ? providedBinVel : rv(providedVelocity * rf(.42, .57));

  let scheduled = 0;

  try {
    // Gate play invocation with playProb: proceed only when playProb) > rf()
    if (typeof playProb === 'number' && !( playProb > rf() )) { return 0; }

    const layer = LM.layers[LM.activeLayer];
    if (!layer || !layer.beatMotifs) { trackRhythm(unit, LM.layers[LM.activeLayer], false); return 0; }

    const beatLen = (typeof tpBeat !== 'undefined' && Number.isFinite(Number(tpBeat)) && Number(tpBeat) > 0) ? Number(tpBeat) : 1;
    const beatKey = Math.floor(on / beatLen);
    const bucket = Array.isArray(layer.beatMotifs[beatKey]) ? layer.beatMotifs[beatKey] : [];
    if (!bucket.length) { trackRhythm(unit, layer, false); return 0; }

    const picks = MotifSpreader.getBeatMotifPicks(layer, beatKey, ri(1, 3));

    for (let pi = 0; pi < picks.length; pi++) {
      const s = picks[pi];
      if (!s || typeof s.note === 'undefined') continue;

      const stutterState = { stutters: new Map(), shifts: new Map(), global: {} };

      // Source channels
      const activeSourceChannels = source.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let sci = 0; sci < activeSourceChannels.length; sci++) {
        const sourceCH = activeSourceChannels[sci];
        const isPrimary = sourceCH === cCH1;
        const onTick = isPrimary ? on + rv(tp * rf(1/9), [-.1, .1], .3) : on + rv(tp * rf(1/3), [-.1, .1], .3);
        const onVel = isPrimary ? providedVelocity * rf(.95, 1.15) : binVel * rf(.95, 1.03);
        p(c, { tick: onTick, type: 'on', vals: [sourceCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? 1 : rv(rf(.92, 1.03)));
        p(c, { tick: offTick, vals: [sourceCH, s.note] }); scheduled++;

          // Schedule stutter if requested — stutter can be controlled by stutterProb or enableStutter boolean
          const stutterEnabledByProb = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow = (typeof stutterEnabledByProb === 'boolean') ? stutterEnabledByProb : (enableStutter && rf() > 0.5);
          if (shouldStutterNow) {
            if (typeof noteCascade !== 'undefined' && noteCascade && typeof noteCascade.scheduleNoteCascade === 'function') {
              noteCascade.scheduleNoteCascade(Stutter, { profile: 'source', channel: sourceCH, note: s.note, on, sustain, velocity: providedVelocity, binVel, isPrimary, shared: stutterState });
            } else {
              if (typeof StutterConfig !== 'undefined' && StutterConfig && StutterConfig.logDebug && !StutterConfig._warnedMissingNoteCascade) { StutterConfig.logDebug(`${unit}.playNotesForUnit: noteCascade.scheduleNoteCascade missing — stutter scheduling skipped`); StutterConfig._warnedMissingNoteCascade = true; }
            }
          }

      }

      // Reflection channels
      const activeReflectionChannels = reflection.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let rci = 0; rci < activeReflectionChannels.length; rci++) {
        const reflectionCH = activeReflectionChannels[rci];
        const isPrimary = reflectionCH === cCH2;
        const onTick = isPrimary ? on + rv(tp * rf(.2), [-.01, .1], .5) : on + rv(tp * rf(1/3), [-.01, .1], .5);
        const onVel = isPrimary ? providedVelocity * rf(.5, .8) : binVel * rf(.55, .9);
        p(c, { tick: onTick, type: 'on', vals: [reflectionCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? rf(.7, 1.2) : rv(rf(.65, 1.3)));
        p(c, { tick: offTick, vals: [reflectionCH, s.note] }); scheduled++;

          const stutterEnabledByProb_ref = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow_ref = (typeof stutterEnabledByProb_ref === 'boolean') ? stutterEnabledByProb_ref : (enableStutter && rf() > 0.5);
          if (shouldStutterNow_ref) {
            if (typeof noteCascade !== 'undefined' && noteCascade && typeof noteCascade.scheduleNoteCascade === 'function') {
              noteCascade.scheduleNoteCascade(Stutter, { profile: 'reflection', channel: reflectionCH, note: s.note, on, sustain, velocity: providedVelocity, binVel, isPrimary, shared: stutterState });
            } else {
              if (typeof StutterConfig !== 'undefined' && StutterConfig && StutterConfig.logDebug && !StutterConfig._warnedMissingNoteCascade) { StutterConfig.logDebug(`${unit}.playNotesForUnit: noteCascade.scheduleNoteCascade missing — stutter scheduling skipped`); StutterConfig._warnedMissingNoteCascade = true; }
            }

        } else {
          if (typeof StutterConfig !== 'undefined' && StutterConfig && StutterConfig.logDebug && !StutterConfig._warnedDedupe) { StutterConfig.logDebug(`${unit}.playNotesForUnit: deduped duplicate on for channel ${reflectionCH} note ${s.note} at ${Math.round(onTick)}`); StutterConfig._warnedDedupe = true; }
        }
      }

      // Bass channels
      if (rf() < clamp(.35 * bpmRatio3, .2, .7)) {
        const activeBassChannels = bass.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
        for (let bci = 0; bci < activeBassChannels.length; bci++) {
          const bassCH = activeBassChannels[bci];
          const isPrimary = bassCH === cCH3;
          const bassNote = modClamp(s.note, 12, 35);
          const onTick = isPrimary ? on + rv(tp * rf(.1), [-.01, .1], .5) : on + rv(tp * rf(1/3), [-.01, .1], .5);
          const onVel = isPrimary ? providedVelocity * rf(1.15, 1.3) : binVel * rf(1.85, 2);
          p(c, { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] }); scheduled++;
          const offTick = on + sustain * (isPrimary ? rf(1.1, 3) : rv(rf(.8, 3.5)));
          p(c, { tick: offTick, vals: [bassCH, bassNote] }); scheduled++;

            if (enableStutter && rf() > 0.5) {
              if (typeof noteCascade !== 'undefined' && noteCascade && typeof noteCascade.scheduleNoteCascade === 'function') {
                noteCascade.scheduleNoteCascade(Stutter, { profile: 'bass', channel: bassCH, note: bassNote, on, sustain, velocity: providedVelocity, binVel, isPrimary, shared: stutterState });
              } else {
                if (typeof StutterConfig !== 'undefined' && StutterConfig && StutterConfig.logDebug && !StutterConfig._warnedMissingNoteCascade) { StutterConfig.logDebug(`${unit}.playNotesForUnit: noteCascade.scheduleNoteCascade missing — stutter scheduling skipped`); StutterConfig._warnedMissingNoteCascade = true; }
              }
            }
          }
        }
      }


    trackRhythm(unit, layer, true);
  } catch (e) {
    console.warn(`${unit}.playNotesForUnit: non-fatal error while playing notes:`, e && e.stack ? e.stack : e);
    try { trackRhythm(unit, LM.layers[LM.activeLayer], false); } catch (e2) { /* swallow */ }
  }

  return scheduled;
};
