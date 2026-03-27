// drummer.js - Generates drum patterns with human-like timing

const V = validator.create('drummer');

function drummerCoupleVelocityRange(minVelocity, maxVelocity, anchorVelocity) {
  const center = (minVelocity + maxVelocity) * 0.5;
  const halfSpan = ((maxVelocity - minVelocity) * 0.5) * 0.32;
  const coupledCenter = clamp(m.round(center * 0.52 + anchorVelocity * 0.48), 1, MIDI_MAX_VALUE);
  const coupledMin = clamp(m.round(coupledCenter - halfSpan), 1, MIDI_MAX_VALUE);
  const coupledMax = clamp(m.round(coupledCenter + halfSpan), coupledMin, MIDI_MAX_VALUE);
  return [coupledMin, coupledMax];
}

drummer = (drumNames,beatOffsets,offsetJitter=rf(.1),stutterChance=.3,stutterRange=[2,m.round(rv(11,[2,3],.3))],stutterDecayFactor=rf(.9,1.1),conductorContext={})=>{
  V.requireDefined(drumNames, 'drumNames');
  V.requireFinite(stutterChance, 'stutterChance');
  V.assertArray(stutterRange, 'stutterRange');
  V.requireFinite(stutterDecayFactor, 'stutterDecayFactor');
  if (drumNames === 'random') {
    const allDrums = Object.keys(drumMap);
    drumNames = [allDrums[m.floor(m.random() * allDrums.length)]];
    beatOffsets = [0];
  }
  const drums=Array.isArray(drumNames) ? drumNames : drumNames.split(',').map(d=>d.trim());
  const offsets=Array.isArray(beatOffsets) ? beatOffsets : [beatOffsets];
  if (offsets.length < drums.length) {
    offsets.push(...new Array(drums.length - offsets.length).fill(0));
  } else if (offsets.length > drums.length) {
    offsets.length=drums.length;
  }
  const combined=drums.map((drum,index)=>({ drum,offset: offsets[index] }));
  if (rf() < .7) {
    if (rf() < .5) {
      combined.reverse();
    }
  } else {
    for (let i=combined.length - 1; i > 0; i--) {
      const j=m.floor(m.random() * (i + 1));
      [combined[i],combined[j]]=[combined[j],combined[i]];
    }
  }
  // R99 E2: Regime-responsive drum stutter chance.
  // Exploring benefits from higher stutter (rhythmic energy helps phase axis),
  // coherent from lower stutter (stability, cleaner rhythms).
  const drumSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
  const drumRegime = drumSnap ? drumSnap.regime : 'exploring';
  const regimeStutterScale = drumRegime === 'exploring' ? 1.30
    : drumRegime === 'coherent' ? 0.70
    : 1.0;
  stutterChance = clamp(stutterChance * regimeStutterScale, 0.10, 0.55);

  const conductorSnapshot = conductorState.getSnapshot();
  const contextIntensity = Number.isFinite(Number(conductorContext.compositeIntensity))
    ? clamp(Number(conductorContext.compositeIntensity), 0, 1)
    : clamp(Number(conductorSnapshot.compositeIntensity), 0, 1);
  const phrasePhase = (typeof conductorContext.phrasePhase === 'string' && conductorContext.phrasePhase.length > 0)
    ? conductorContext.phrasePhase
    : conductorSnapshot.phrasePhase;
  const accentBoost = conductorContext.accent ? 0.12 : 0;
  const phaseBoost = (phrasePhase === 'climax' || phrasePhase === 'peak') ? 0.12 : (phrasePhase === 'resolution' ? -0.05 : 0);
  const velocityScale = clamp(0.9 + contextIntensity * 0.14 + accentBoost * 0.28 + phaseBoost * 0.22, 0.84, 1.08);
  const sharedVelocityAnchor = clamp(m.round(90 + contextIntensity * 12 + (conductorContext.accent ? 3 : 0)), 84, 108);

  const adjustedOffsets = combined.map(({ offset }) => {
    // Preserve large/offbeat integer offsets (e.g., 10 beats) rather than reducing them to
    // their fractional part. For fractional offsets (0..1), allow jitter and wrap into [0,1).
    // Preserve explicit zero offsets exactly
    if (offset === 0) return 0;
    if (m.abs(offset) >= 1) {
      if (rf() < .3) return offset;
      const jitter = (m.random() < 0.5 ? -offsetJitter * rf(.5, 1) : offsetJitter * rf(.5, 1));
      return offset + jitter;
    }
    if (rf() < .3) {
      return offset;
    } else {
      const adjusted = offset + (m.random() < 0.5 ? -offsetJitter * rf(.5, 1) : offsetJitter * rf(.5, 1));
      // keep only the fractional component for sub-beat offsets but avoid returning exactly 0
      const fractional = adjusted - m.floor(adjusted);
      // Never allow jitter to move a fractional offset *earlier* than the original offset - only allow equal or later adjustments
      return fractional === 0 ? offset : m.max(fractional, offset);
    }
  });
  combined.forEach(({ drum, offset }, idx) => {
    const useOffset = (adjustedOffsets[idx] !== undefined) ? adjustedOffsets[idx] : offset;
    const drumInfo = drumMap[drum];
    if (drumInfo) {
      if (rf() < stutterChance) {
        const numStutters = ri(...stutterRange);
        const stutterDuration = .25 * ri(1, 8) / numStutters;
        const [baseMinVelocity, baseMaxVelocity] = drumInfo.velocityRange;
        const minVelocity = clamp(m.round(baseMinVelocity * velocityScale), 1, MIDI_MAX_VALUE);
        const maxVelocity = clamp(m.round(baseMaxVelocity * velocityScale), minVelocity, MIDI_MAX_VALUE);
        const [coupledMinVelocity, coupledMaxVelocity] = drummerCoupleVelocityRange(minVelocity, maxVelocity, sharedVelocityAnchor);
        const isFadeIn = rf() < 0.7;
        for (let i = 0; i < numStutters; i++) {
          // ANTI-PATTERN: counter-productive "validation" masks issues and makes code unreadable
          // const tickVal = (Number.isFinite(Number(beatStart)) ? Number(beatStart) : 0) + ((Number.isFinite(Number(useOffset)) ? Number(useOffset) : 0) + i * stutterDuration) * (Number.isFinite(Number(tpBeat)) ? Number(tpBeat) : 0);
          const timeInSeconds = beatStartTime + (useOffset + i * stutterDuration) * spBeat;
          let currentVelocity;
          if (isFadeIn) {
            const fadeInMultiplier = stutterDecayFactor * (i / (numStutters * rf(0.4, 2.2) - 1));
            // Anchor stutter velocities to the drum's declared range and scale across [min,max]
            currentVelocity = clamp(m.min(coupledMaxVelocity, coupledMinVelocity + (coupledMaxVelocity - coupledMinVelocity) * fadeInMultiplier), 0, MIDI_MAX_VALUE);
          } else {
            const fadeOutMultiplier = 1 - (stutterDecayFactor * (i / (numStutters * rf(0.4, 2.2) - 1)));
            currentVelocity = clamp(m.max(0, coupledMinVelocity + (coupledMaxVelocity - coupledMinVelocity) * fadeOutMultiplier), 0, MIDI_MAX_VALUE);
          }
          const emittedVelocity = m.floor(currentVelocity);
          p(c, { timeInSeconds, type: 'on', vals: [drumCH, drumInfo.note, emittedVelocity] });
          traceDrain.recordFamilyVelocity('drums', emittedVelocity);
        }
      } else {
        const timeInSeconds = beatStartTime + useOffset * spBeat;
        const baseMin = Number(drumInfo.velocityRange[0]);
        const baseMax = Number(drumInfo.velocityRange[1]);
        const scaledMin = clamp(m.round(baseMin * velocityScale), 1, MIDI_MAX_VALUE);
        const scaledMax = clamp(m.round(baseMax * velocityScale), scaledMin, MIDI_MAX_VALUE);
        const [coupledMin, coupledMax] = drummerCoupleVelocityRange(scaledMin, scaledMax, sharedVelocityAnchor);
        const emittedVelocity = ri(coupledMin, coupledMax);
        p(c, { timeInSeconds, type: 'on', vals: [drumCH, drumInfo.note, emittedVelocity] });
        traceDrain.recordFamilyVelocity('drums', emittedVelocity);
      }
    }
  });
};
