// playNotes.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

playNotes = function(unit = 'subdiv', opts = {}) {
  const {
    enableStutter = false,
    playProb = 0,
    stutterProb = 0
  } = opts;

  const layer = LM.layers[LM.activeLayer];
  const activeComposer = (layer && layer.measureComposer && typeof layer.measureComposer === 'object')
    ? layer.measureComposer
    : ((typeof composer === 'object' && composer !== null) ? composer : null);

  const runtimeProfile = (activeComposer && activeComposer.runtimeProfile && typeof activeComposer.runtimeProfile === 'object')
    ? activeComposer.runtimeProfile
    : null;

  const emissionAdjustments = (runtimeProfile && typeof ComposerRuntimeProfileAdapter !== 'undefined' && ComposerRuntimeProfileAdapter && typeof ComposerRuntimeProfileAdapter.getEmissionAdjustments === 'function')
    ? ComposerRuntimeProfileAdapter.getEmissionAdjustments(runtimeProfile)
    : {
      baseVelocity: (activeComposer && Number.isFinite(Number(activeComposer.baseVelocity))) ? Number(activeComposer.baseVelocity) : null,
      velocityScale: (activeComposer && Number.isFinite(Number(activeComposer.profileVelocityScale))) ? Number(activeComposer.profileVelocityScale) : 1,
      timingOffsetUnits: (activeComposer && Number.isFinite(Number(activeComposer.profileTimingOffsetUnits))) ? Number(activeComposer.profileTimingOffsetUnits) : 0,
      swingAmount: (activeComposer && Number.isFinite(Number(activeComposer.profileSwingAmount))) ? Number(activeComposer.profileSwingAmount) : 0
    };

  const baseVelocitySeed = (Number.isFinite(Number(emissionAdjustments.baseVelocity)))
    ? Number(emissionAdjustments.baseVelocity)
    : velocity;

  const combinedVelocityScale = Number.isFinite(Number(emissionAdjustments.velocityScale))
    ? Number(emissionAdjustments.velocityScale)
    : 1;

  const motifTimingOffsetUnits = Number.isFinite(Number(emissionAdjustments.timingOffsetUnits))
    ? Number(emissionAdjustments.timingOffsetUnits)
    : 0;
  const rhythmSwingAmount = Number.isFinite(Number(emissionAdjustments.swingAmount))
    ? Number(emissionAdjustments.swingAmount)
    : 0;

  if (!Number.isFinite(Number(tpUnit))) {
    throw new Error(`${unit}.playNotes: tpUnit must be a finite number`);
  }
  if (!Number.isFinite(Number(beatStart))) {
    throw new Error(`${unit}.playNotes: beatStart must be a finite number`);
  }
  const swingTicks = (Number.isFinite(Number(beatIndex)) && rhythmSwingAmount !== 0 && typeof RhythmManager !== 'undefined' && RhythmManager && typeof RhythmManager.swingOffset === 'function')
    ? Number(RhythmManager.swingOffset(Number(beatIndex), rhythmSwingAmount))
    : 0;
  const timingOffsetTicks = (motifTimingOffsetUnits * Number(tpUnit)) + swingTicks;

  // Compute on and sustain
  const on = unitStart + timingOffsetTicks + (tpUnit * rv(rf(.2), [-.1, .07], .3));
  const shortSustain = rv(rf(m.max(tpUnit * .5, tpUnit / unitsPerParent), (tpUnit * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
  const longSustain = rv(rf(tpUnit * .8, (tpParent * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -0.1]);
  const useShort = subdivsPerMinute > ri(400, 650);
  const sustain = (useShort ? shortSustain : longSustain) * rv(rf(.8, 1.3));
  velocity = rl(baseVelocitySeed,-3,3,95,105);
  if (!Number.isFinite(combinedVelocityScale) || combinedVelocityScale <= 0) {
    throw new Error(`${unit}.playNotes: combined profile velocity scale must be a positive finite number`);
  }
  velocity = m.max(1, m.min(127, m.round(velocity * combinedVelocityScale)));
  const binVel = rv(velocity * rf(.4, .9));

  let scheduled = 0;
  crossModulateRhythms();

  // Apply subtle noise modulation to base velocity for organic variation
  if (typeof getNoiseProfile !== 'function') {
    throw new Error(`${unit}.playNotes: getNoiseProfile not available`);
  }
  const noiseProfile = getNoiseProfile('subtle');
  if (!noiseProfile || typeof noiseProfile !== 'object') {
    throw new Error(`${unit}.playNotes: invalid noise profile returned for "subtle"`);
  }
  const influenceX = Number(noiseProfile.influenceX);
  const influenceY = Number(noiseProfile.influenceY);
  if (!Number.isFinite(influenceX) || !Number.isFinite(influenceY)) {
    throw new Error(`${unit}.playNotes: subtle noise profile influence must be finite`);
  }
  const noiseInfluence = clamp((influenceX + influenceY) / 2, 0, 1);
  const currentTime = beatStart + tpUnit * 0.5; // Approximate time within the unit
  const layerIdSeed = Number.isFinite(Number(layer && layer.id))
    ? Number(layer.id)
    : (typeof LM.activeLayer === 'string' ? Array.from(LM.activeLayer).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) : 0);
  const voiceIdSeed = m.round(Number(beatStart) * 73 + layerIdSeed * 43 + (Number.isFinite(Number(measureCount)) ? Number(measureCount) : 0)); // Deterministic voice ID from context

  // Gate play invocation with playProb and crossModulation
  if (typeof playProb === 'number' && (rf() > playProb) && (crossModulation < rv(rf(2, 4), [-.2, -.3], .05))) {
    return trackRhythm(unit, layer, false);
  }

  // Delegate motif selection and transformation to playMotifs
  const picks = playMotifs(unit, layer);

  // Validate notes belong to active composer's pitch class set (before try-catch so errors propagate)
  // Uses live HarmonicContext scale for composers with timeVaryingScaleContext.
  if (activeComposer && typeof activeComposer === 'object') {
    if (typeof modClamp !== 'function') {
      throw new Error(`${unit}.playNotes: modClamp not available for pitch-class validation`);
    }

    const validPCs = new Set();
    const caps = (typeof activeComposer.getCapabilities === 'function')
      ? activeComposer.getCapabilities()
      : (activeComposer.capabilities || {});

    if (caps && caps.timeVaryingScaleContext === true && typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function') {
      const windowScale = HarmonicContext.getField('scale');
      if (Array.isArray(windowScale) && windowScale.length > 0) {
        for (let si = 0; si < windowScale.length; si++) {
          const entry = windowScale[si];
          if (typeof entry === 'string') {
            const pc = t.Note.chroma(entry);
            if (typeof pc === 'number' && Number.isFinite(pc)) validPCs.add(modClamp(pc, 0, 11));
          } else if (typeof entry === 'number' && Number.isFinite(entry)) {
            validPCs.add(modClamp(entry, 0, 11));
          }
        }
      }
    }

    if (validPCs.size === 0 && Array.isArray(activeComposer.notes)) {
      for (let ni = 0; ni < activeComposer.notes.length; ni++) {
        const noteName = activeComposer.notes[ni];
        if (typeof noteName === 'string') {
          const pc = t.Note.chroma(noteName);
          if (typeof pc === 'number' && Number.isFinite(pc)) {
            validPCs.add(modClamp(pc, 0, 11));
          }
        } else if (typeof noteName === 'number' && Number.isFinite(noteName)) {
          validPCs.add(modClamp(noteName, 0, 11));
        }
      }
    }

    if (validPCs.size > 0) {
      for (let pi = 0; pi < picks.length; pi++) {
        const pickNote = Number(picks[pi].note);
        if (!Number.isFinite(pickNote)) {
          throw new Error(`${unit}.playNotes: pick note must be finite, got ${picks[pi].note}`);
        }
        const pickPC = modClamp(pickNote, 0, 11);
        if (!validPCs.has(pickPC)) {
          throw new Error(`${unit}.playNotes(MARKER20250210): note ${pickNote} (PC ${pickPC}) not in active composer - valid PCs: ${Array.from(validPCs).sort((a,b)=>a-b).join(',')}`);
        }
      }
    }
  }

  try {
    for (let pi = 0; pi < picks.length; pi++) {
      const s = picks[pi];
      if (!s || typeof s.note === 'undefined') throw new Error(`${unit}.playNotes: invalid note object in motif picks`);

      // Source channels
      const activeSourceChannels = source.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let sci = 0; sci < activeSourceChannels.length; sci++) {
        const sourceCH = activeSourceChannels[sci];
        const isPrimary = sourceCH === cCH1;
        const onTick = isPrimary ? on + rv(tpUnit * rf(1/9), [-.1, .1], .3) : on + rv(tpUnit * rf(1/3), [-.1, .1], .3);
        const baseOnVel = isPrimary ? velocity * rf(.95, 1.15) : binVel * rf(.75, 1.03);
        const sourceVoiceId = voiceIdSeed + sourceCH * 17 + pi * 101 + sci;
        const sourceNoiseBase = baseOnVel * (1 - 0.12 * noiseInfluence);
        const onVel = applyNoiseToVelocity(sourceNoiseBase, sourceVoiceId, currentTime, 'subtle');
        p(c, { tick: onTick, type: 'on', vals: [sourceCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? 1 : rv(rf(.92, 1.03)));
        p(c, { tick: offTick, vals: [sourceCH, s.note] }); scheduled++;

          // Schedule stutter if requested — stutter can be controlled by stutterProb or enableStutter boolean
          const stutterEnabledByProb = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow = (typeof stutterEnabledByProb === 'boolean') ? stutterEnabledByProb : (enableStutter && rf() > 0.5);
          if (shouldStutterNow) {
            Stutter.scheduleStutterForUnit({ profile: 'source', channel: sourceCH, note: s.note, on, sustain, velocity, binVel, isPrimary });
            scheduleStutterNotesFromDensity('source', sourceCH, s.note, onVel, onTick, sustain, stutterProb);
          }
        }

      // Reflection channels
      const activeReflectionChannels = reflection.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let rci = 0; rci < activeReflectionChannels.length; rci++) {
        const reflectionCH = activeReflectionChannels[rci];
        const isPrimary = reflectionCH === cCH2;
        const onTick = isPrimary ? on + rv(tpUnit * rf(.2), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
        const baseOnVel = isPrimary ? velocity * rf(.7, 1.2) : binVel * rf(.55, 1.1);
        const reflectionVoiceId = voiceIdSeed + reflectionCH * 19 + pi * 131 + rci;
        const reflectionNoiseBase = baseOnVel * (1 - 0.10 * noiseInfluence);
        const onVel = applyNoiseToVelocity(reflectionNoiseBase, reflectionVoiceId, currentTime, 'subtle');
        p(c, { tick: onTick, type: 'on', vals: [reflectionCH, s.note, onVel] }); scheduled++;
        const offTick = on + sustain * (isPrimary ? rf(.7, 1.2) : rv(rf(.65, 1.3)));
        p(c, { tick: offTick, vals: [reflectionCH, s.note] }); scheduled++;

          const stutterEnabledByProb_ref = (typeof stutterProb === 'number') ? (stutterProb > rf()) : undefined;
          const shouldStutterNow_ref = (typeof stutterEnabledByProb_ref === 'boolean') ? stutterEnabledByProb_ref : (enableStutter && rf() > 0.5);
          if (shouldStutterNow_ref) {
            Stutter.scheduleStutterForUnit({ profile: 'reflection', channel: reflectionCH, note: s.note, on, sustain, velocity, binVel, isPrimary });
            scheduleStutterNotesFromDensity('reflection', reflectionCH, s.note, onVel, onTick, sustain, stutterProb);
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
          const onVelRaw = isPrimary ? velocity * rf(1.15, 1.5) : binVel * rf(1.85, 2.5);
          const bassVoiceId = voiceIdSeed + bassCH * 23 + pi * 151 + bci;
          const bassNoiseBase = onVelRaw * (1 - 0.08 * noiseInfluence);
          const onVel = applyNoiseToVelocity(bassNoiseBase, bassVoiceId, currentTime, 'subtle');
          p(c, { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] }); scheduled++;
          const offTick = on + sustain * (isPrimary ? rf(1.1, 3) : rv(rf(.8, 3.5)));
          p(c, { tick: offTick, vals: [bassCH, bassNote] }); scheduled++;

          if (enableStutter && rf() > 0.5) {
            Stutter.scheduleStutterForUnit({ profile: 'bass', channel: bassCH, note: bassNote, on, sustain, velocity, binVel, isPrimary });
            scheduleStutterNotesFromDensity('bass', bassCH, bassNote, onVel, onTick, sustain, stutterProb);
          }
        }
      }
    }
    trackRhythm(unit, layer, true);
  } catch (e) {
    trackRhythm(unit, layer, false);
    throw new Error(`${unit}.playNotes: non-fatal error while playing notes: ${e && e.stack ? e.stack : String(e)}`);
  }

  return scheduled;
};
