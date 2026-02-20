// drummer.js - Generates drum patterns with human-like timing

const _drV = Validator.create('drummer');

drummer = (drumNames,beatOffsets,offsetJitter=rf(.1),stutterChance=.3,stutterRange=[2,m.round(rv(11,[2,3],.3))],stutterDecayFactor=rf(.9,1.1),conductorContext={})=>{
  _drV.requireDefined(drumNames, 'drumNames');
  _drV.requireFinite(stutterChance, 'stutterChance');
  _drV.assertArray(stutterRange, 'stutterRange');
  _drV.requireFinite(stutterDecayFactor, 'stutterDecayFactor');
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
  const contextIntensity = Number.isFinite(Number(conductorContext.compositeIntensity))
    ? clamp(Number(conductorContext.compositeIntensity), 0, 1)
    : (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getSnapshot === 'function')
      ? clamp(Number(ConductorState.getSnapshot().compositeIntensity) || 0, 0, 1)
      : 0;
  const phrasePhase = (typeof conductorContext.phrasePhase === 'string' && conductorContext.phrasePhase.length > 0)
    ? conductorContext.phrasePhase
    : ((typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getSnapshot === 'function')
      ? (ConductorState.getSnapshot().phrasePhase || 'development')
      : 'development');
  const accentBoost = conductorContext.accent ? 0.12 : 0;
  const phaseBoost = (phrasePhase === 'climax' || phrasePhase === 'peak') ? 0.12 : (phrasePhase === 'resolution' ? -0.05 : 0);
  const velocityScale = clamp(0.8 + contextIntensity * 0.45 + accentBoost + phaseBoost, 0.55, 1.4);

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
      // Never allow jitter to move a fractional offset *earlier* than the original offset — only allow equal or later adjustments
      return fractional === 0 ? offset : m.max(fractional, offset);
    }
  });
  combined.forEach(({ drum, offset }, idx) => {
    const useOffset = (typeof adjustedOffsets[idx] !== 'undefined') ? adjustedOffsets[idx] : offset;
    const drumInfo = drumMap[drum];
    if (drumInfo) {
      if (rf() < stutterChance) {
        const numStutters = ri(...stutterRange);
        const stutterDuration = .25 * ri(1, 8) / numStutters;
        const [baseMinVelocity, baseMaxVelocity] = drumInfo.velocityRange;
        const minVelocity = clamp(m.round(baseMinVelocity * velocityScale), 1, MIDI_MAX_VALUE);
        const maxVelocity = clamp(m.round(baseMaxVelocity * velocityScale), minVelocity, MIDI_MAX_VALUE);
        const isFadeIn = rf() < 0.7;
        for (let i = 0; i < numStutters; i++) {
          // ANTI-PATTERN: counter-productive "validation" masks issues and makes code unreadable
          // const tickVal = (Number.isFinite(Number(beatStart)) ? Number(beatStart) : 0) + ((Number.isFinite(Number(useOffset)) ? Number(useOffset) : 0) + i * stutterDuration) * (Number.isFinite(Number(tpBeat)) ? Number(tpBeat) : 0);
          const tickVal = beatStart + (useOffset + i * stutterDuration) * tpBeat;
          const tick = m.round(tickVal);
          let currentVelocity;
          if (isFadeIn) {
            const fadeInMultiplier = stutterDecayFactor * (i / (numStutters * rf(0.4, 2.2) - 1));
            // Anchor stutter velocities to the drum's declared range and scale across [min,max]
            currentVelocity = clamp(m.min(maxVelocity, minVelocity + (maxVelocity - minVelocity) * fadeInMultiplier), 0, MIDI_MAX_VALUE);
          } else {
            const fadeOutMultiplier = 1 - (stutterDecayFactor * (i / (numStutters * rf(0.4, 2.2) - 1)));
            currentVelocity = clamp(m.max(0, minVelocity + (maxVelocity - minVelocity) * fadeOutMultiplier), 0, MIDI_MAX_VALUE);
          }
          p(c, { tick: tick, type: 'on', vals: [drumCH, drumInfo.note, m.floor(currentVelocity)] });
        }
      } else {
        const tickVal = beatStart + useOffset * tpBeat;
        const tick = m.round(tickVal);
        const baseMin = Number(drumInfo.velocityRange[0]);
        const baseMax = Number(drumInfo.velocityRange[1]);
        const scaledMin = clamp(m.round(baseMin * velocityScale), 1, MIDI_MAX_VALUE);
        const scaledMax = clamp(m.round(baseMax * velocityScale), scaledMin, MIDI_MAX_VALUE);
        p(c, { tick: tick, type: 'on', vals: [drumCH, drumInfo.note, ri(scaledMin, scaledMax)] });
      }
    }
  });
};
