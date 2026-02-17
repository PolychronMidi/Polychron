// playNotes.js - Unit-level note emission for beat/div/subdiv/subsubdiv
// Implements a focused subset of stage.js note emission logic and delegates
// stutter scheduling to the naked global `noteCascade` when available.

playNotes = function(unit = 'subdiv', opts = {}) {
  const {
    playProb = 0,
    stutterProb = 0
  } = opts;

  if (!LM || typeof LM.getComposerFor !== 'function') {
    throw new Error(`${unit}.playNotes: LayerManager.getComposerFor not available`);
  }
  if (typeof LM.activeLayer !== 'string' || LM.activeLayer.length === 0) {
    throw new Error(`${unit}.playNotes: LayerManager.activeLayer is not set`);
  }
  const layer = LM.layers[LM.activeLayer];
  if (!layer || typeof layer !== 'object') {
    throw new Error(`${unit}.playNotes: active layer "${LM.activeLayer}" not found`);
  }
  const activeComposer = LM.getComposerFor(LM.activeLayer);

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

  // Apply unit-level velocity scaling from motifConfig hierarchy
  // (beat=1.0, div=0.9, subdiv=0.85, subsubdiv=0.8 — finer units play softer)
  if (typeof motifConfig !== 'undefined' && motifConfig && typeof motifConfig.getUnitProfile === 'function') {
    const unitProfile = motifConfig.getUnitProfile(unit);
    if (unitProfile && Number.isFinite(unitProfile.velocityScale)) {
      velocity = m.max(1, m.min(127, m.round(velocity * unitProfile.velocityScale)));
    }
  }

  // Apply voiceConfig profile for additional velocity shaping
  if (typeof voiceConfig !== 'undefined' && voiceConfig && typeof voiceConfig.getProfile === 'function') {
    try {
      const vcProfile = voiceConfig.getProfile('default');
      if (vcProfile && Number.isFinite(vcProfile.baseVelocity)) {
        // Blend configured base with computed velocity (30% config influence)
        velocity = m.max(1, m.min(127, m.round(velocity * 0.7 + vcProfile.baseVelocity * 0.3)));
      }
    } catch { /* no profile available — use velocity as-is */ }
  }

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

  // DynamismEngine is the single probability authority. When probs arrive from
  // GlobalConductor they are already DynamismEngine-resolved; pass them through
  // without re-modulating to prevent double-application of the same signals.
  // Only invoke DynamismEngine directly for sub-beat units (div/subdiv/subsubdiv)
  // that need per-unit pulse refinement.
  const needsPerUnitResolve = (unit !== 'beat');
  const resolved = (needsPerUnitResolve && typeof DynamismEngine !== 'undefined' && DynamismEngine && typeof DynamismEngine.resolve === 'function')
    ? DynamismEngine.resolve(unit, { playProb, stutterProb })
    : { playProb, stutterProb, composite: 0 };
  const resolvedPlayProb = Number(resolved.playProb);
  const resolvedStutterProb = Number(resolved.stutterProb);
  if (!Number.isFinite(resolvedPlayProb) || !Number.isFinite(resolvedStutterProb)) {
    throw new Error(`${unit}.playNotes: resolved probabilities must be finite`);
  }

  // Per-layer + per-unit voice budget (prevents first-invocation dominance)
  try {
    const layerName = (typeof LM !== 'undefined' && LM && typeof LM.activeLayer === 'string') ? LM.activeLayer : 'L?';
    const unitBudgetKey = `${layerName}:${unit}:${Number.isFinite(Number(unitStart)) ? unitStart : 'u'}`;

    // Ensure per-layer budget maps exist (init.js defines these globals)
    if (!remainingVoiceSlotsByLayer || typeof remainingVoiceSlotsByLayer !== 'object') remainingVoiceSlotsByLayer = {};
    if (!lastVoiceBudgetKeyByLayer || typeof lastVoiceBudgetKeyByLayer !== 'object') lastVoiceBudgetKeyByLayer = {};

    if (lastVoiceBudgetKeyByLayer[layerName] !== unitBudgetKey) {
      const unitCfg = (unit === 'div') ? (typeof DIV_VOICES !== 'undefined' ? DIV_VOICES : BEAT_VOICES)
        : (unit === 'subdiv') ? (typeof SUBDIV_VOICES !== 'undefined' ? SUBDIV_VOICES : BEAT_VOICES)
        : (unit === 'subsubdiv') ? (typeof SUBSUBDIV_VOICES !== 'undefined' ? SUBSUBDIV_VOICES : BEAT_VOICES)
        : (typeof BEAT_VOICES !== 'undefined' ? BEAT_VOICES : VOICES);
      remainingVoiceSlotsByLayer[layerName] = (unitCfg && Number.isFinite(Number(unitCfg.max))) ? Number(unitCfg.max) : 4;
      lastVoiceBudgetKeyByLayer[layerName] = unitBudgetKey;
    }

    // Keep legacy globals in sync for backward compatibility
    remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
    lastVoiceBudgetKey = `${layerName}:${lastVoiceBudgetKeyByLayer[layerName] || ''}`;
  } catch {
    /* ignore budget reset failures */
  }

  // Gate play invocation with playProb and crossModulation
  if (typeof resolvedPlayProb === 'number' && (rf() > resolvedPlayProb * rf(1,2)) && (crossModulation < rv(rf(1.8,2.2), [-.2, -.3], .05))) {
    return trackRhythm(unit, layer, false);
  }

  // Delegate motif selection and transformation to playMotifs
  const picks = playMotifs(unit, layer);

  // Apply voiceModulator to get per-pick velocity distribution
  // This gives each voice a slightly different velocity for natural ensemble feel
  if (typeof voiceModulator !== 'undefined' && voiceModulator && typeof voiceModulator.distribute === 'function' && Array.isArray(picks) && picks.length > 0) {
    const distributed = voiceModulator.distribute(picks.map(p => p.note), { baseVelocity: velocity });
    for (let di = 0; di < m.min(distributed.length, picks.length); di++) {
      if (Number.isFinite(distributed[di].velocity)) picks[di]._distributedVelocity = distributed[di].velocity;
    }
  }

  // Enforce per-layer, per-unit remaining voice slots — trim picks if necessary
  try {
    if (Array.isArray(picks) && picks.length > 0) {
      const layerName = (typeof LM !== 'undefined' && LM && typeof LM.activeLayer === 'string') ? LM.activeLayer : 'L?';
      const available = Number.isFinite(Number(remainingVoiceSlotsByLayer && remainingVoiceSlotsByLayer[layerName] ? remainingVoiceSlotsByLayer[layerName] : remainingVoiceSlots))
        ? m.max(0, Number(remainingVoiceSlotsByLayer[layerName] ?? remainingVoiceSlots))
        : picks.length;
      const allowed = Number.isFinite(available) ? m.max(0, m.min(picks.length, available)) : picks.length;
      if (allowed <= 0) {
        // no budget available for this layer/unit — skip emission
        return trackRhythm(unit, layer, false);
      }
      if (allowed < picks.length) picks.length = allowed; // truncate in-place

      // Decrement per-layer budget and keep legacy global in sync
      if (!remainingVoiceSlotsByLayer) remainingVoiceSlotsByLayer = {};
      remainingVoiceSlotsByLayer[layerName] = m.max(0, (remainingVoiceSlotsByLayer[layerName] ?? remainingVoiceSlots) - picks.length);
      remainingVoiceSlots = remainingVoiceSlotsByLayer[layerName];
    }
  } catch {
    /* ignore budget enforcement failures */
  }

  try {
    for (let pi = 0; pi < picks.length; pi++) {
      const s = picks[pi];
      if (!s || typeof s.note === 'undefined') throw new Error(`${unit}.playNotes: invalid note object in motif picks`);

      // Stutter check: ONCE per pick — compute octave shift but apply it only to the primary source channel
      const shouldStutter = (typeof resolvedStutterProb === 'number') ? (resolvedStutterProb > rf()) : false;
      let selectedShift = 0;
      if (shouldStutter) {
        const minNote = m.max(0, OCTAVE.min * 12 - 1);
        const maxNote = OCTAVE.max * 12 - 1;
        const octaveCandidates = [];
        for (let mag = 1; mag <= 3; mag++) {
          if (s.note + mag * 12 <= maxNote) octaveCandidates.push(mag * 12);
          if (s.note - mag * 12 >= minNote) octaveCandidates.push(-mag * 12);
        }
        if (octaveCandidates.length > 0) {
          selectedShift = octaveCandidates[ri(octaveCandidates.length - 1)];
        }
      }

      // Per-pick velocity modifier from voiceModulator distribution (ensemble feel)
      const pickVelScale = (s._distributedVelocity && Number.isFinite(s._distributedVelocity))
        ? clamp(s._distributedVelocity / m.max(1, velocity), 0.5, 1.5)
        : 1;

      // Source channels — stereo mirror of the pick
      const activeSourceChannels = source.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let sci = 0; sci < activeSourceChannels.length; sci++) {
        const sourceCH = activeSourceChannels[sci];
        const isPrimary = sourceCH === cCH1;
        const onTick = isPrimary ? on + rv(tpUnit * rf(1/9), [-.1, .1], .3) : on + rv(tpUnit * rf(1/3), [-.1, .1], .3);
        const baseOnVel = (isPrimary ? velocity * rf(.95, 1.15) : binVel * rf(.75, 1.03)) * pickVelScale;
          const sourceVoiceId = voiceIdSeed + sourceCH * 17 + pi * 101 + sci;
        const sourceNoiseBase = baseOnVel * (1 - 0.12 * noiseInfluence);
        const { perProbScaled: perProbScaledSrc, onVel } = getChannelCoherence(sourceCH, 'source', sourceNoiseBase, sourceVoiceId, currentTime);

        const applySelectedShiftToSource = isPrimary && selectedShift !== 0 && rf() < perProbScaledSrc;
        const noteToEmit = applySelectedShiftToSource
          ? modClamp(s.note + selectedShift, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1)
          : s.note;

        const srcOnEvt = { tick: onTick, type: 'on', vals: [sourceCH, noteToEmit, onVel] };
        const offTick = on + sustain * (isPrimary ? 1 : rv(rf(.92, 1.03)));
        const srcOffEvt = { tick: offTick, vals: [sourceCH, noteToEmit] };
        microUnitAttenuator.record(srcOnEvt, srcOffEvt, crossModulation); scheduled += 2;
      }

      // Reflection channels — stereo mirror of the pick
      const activeReflectionChannels = reflection.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
      for (let rci = 0; rci < activeReflectionChannels.length; rci++) {
        const reflectionCH = activeReflectionChannels[rci];
        const isPrimary = reflectionCH === cCH2;
        const onTick = isPrimary ? on + rv(tpUnit * rf(.2), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
        const baseOnVel = (isPrimary ? velocity * rf(.7, 1.2) : binVel * rf(.55, 1.1)) * pickVelScale;
        const reflectionVoiceId = voiceIdSeed + reflectionCH * 19 + pi * 131 + rci;
        const reflectionNoiseBase = baseOnVel * (1 - 0.10 * noiseInfluence);
        const { perProbScaled: perProbScaledRefl, onVel: onVelRefl } = getChannelCoherence(reflectionCH, 'reflection', reflectionNoiseBase, reflectionVoiceId, currentTime);

        // Apply stutter to a *subset* of reflection channels when selected by Stutter's beatContext
        const reflectSelected = (typeof Stutter !== 'undefined' && Stutter && Stutter.beatContext && Stutter.beatContext.selectedReflectionChannels && Stutter.beatContext.selectedReflectionChannels.has(reflectionCH));
        const reflectApplyShift = reflectSelected && selectedShift !== 0 && rf() < perProbScaledRefl;
        const reflectionEmitNote = reflectApplyShift
          ? modClamp(s.note + selectedShift, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1)
          : s.note;

        const reflOnEvt = { tick: onTick, type: 'on', vals: [reflectionCH, reflectionEmitNote, onVelRefl] };
        const offTick = on + sustain * (isPrimary ? rf(.7, 1.2) : rv(rf(.65, 1.3)));
        const reflOffEvt = { tick: offTick, vals: [reflectionCH, reflectionEmitNote] };
        microUnitAttenuator.record(reflOnEvt, reflOffEvt, crossModulation); scheduled += 2;
      }

      // Bass channels — stereo mirror of the pick (clamped to bass range)
      if (rf() < clamp(.75 * bpmRatio3, .2, .7)) {
        const activeBassChannels = bass.filter(ch => flipBin ? flipBinT.includes(ch) : flipBinF.includes(ch));
        for (let bci = 0; bci < activeBassChannels.length; bci++) {
          const bassCH = activeBassChannels[bci];
          const isPrimary = bassCH === cCH3;


          const onTick = isPrimary ? on + rv(tpUnit * rf(.1), [-.01, .1], .5) : on + rv(tpUnit * rf(1/3), [-.01, .1], .5);
          const onVelRaw = (isPrimary ? velocity * rf(1.15, 1.5) : binVel * rf(1.85, 2.5)) * pickVelScale;
          const bassVoiceId = voiceIdSeed + bassCH * 23 + pi * 151 + bci;
          const bassNoiseBase = onVelRaw * (1 - 0.08 * noiseInfluence);
          const { perProbScaled: perProbScaledBass, onVel } = getChannelCoherence(bassCH, 'bass', bassNoiseBase, bassVoiceId, currentTime);

          // Apply stutter octave shift to a small subset of bass channels when selected
          const bassSelected = (typeof Stutter !== 'undefined' && Stutter && Stutter.beatContext && Stutter.beatContext.selectedBassChannels && Stutter.beatContext.selectedBassChannels.has(bassCH));
          const bassApplyShift = bassSelected && selectedShift !== 0 && rf() < perProbScaledBass;
          const bassEmitBase = bassApplyShift ? s.note + selectedShift : s.note;
          const bassNote = modClamp(bassEmitBase, m.max(0, OCTAVE.min * 12 - 1), 59);

          const bassOnEvt = { tick: onTick, type: 'on', vals: [bassCH, bassNote, onVel] };
          const offTick = on + sustain * (isPrimary ? rf(1.1, 3) : rv(rf(.8, 3.5)));
          const bassOffEvt = { tick: offTick, vals: [bassCH, bassNote] };
          microUnitAttenuator.record(bassOnEvt, bassOffEvt, crossModulation); scheduled += 2;
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
