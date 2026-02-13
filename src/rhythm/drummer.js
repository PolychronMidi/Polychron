// drummer.js - Generates drum patterns with human-like timing

drummer = (drumNames,beatOffsets,offsetJitter=rf(.1),stutterChance=.3,stutterRange=[2,m.round(rv(11,[2,3],.3))],stutterDecayFactor=rf(.9,1.1))=>{
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
      let adjusted = offset + (m.random() < 0.5 ? -offsetJitter * rf(.5, 1) : offsetJitter * rf(.5, 1));
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
        const [minVelocity, maxVelocity] = drumInfo.velocityRange;
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
            currentVelocity = clamp(m.min(maxVelocity, minVelocity + (maxVelocity - minVelocity) * fadeInMultiplier), 0, 127);
          } else {
            const fadeOutMultiplier = 1 - (stutterDecayFactor * (i / (numStutters * rf(0.4, 2.2) - 1)));
            currentVelocity = clamp(m.max(0, minVelocity + (maxVelocity - minVelocity) * fadeOutMultiplier), 0, 127);
          }
          p(c, { tick: tick, type: 'on', vals: [drumCH, drumInfo.note, m.floor(currentVelocity)] });
        }
      } else {
        const tickVal = beatStart + useOffset * tpBeat;
        const tick = m.round(tickVal);
        p(c, { tick: tick, type: 'on', vals: [drumCH, drumInfo.note, ri(...drumInfo.velocityRange)] });
      }
    }
  });
};
