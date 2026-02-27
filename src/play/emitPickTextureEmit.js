// emitPickTextureEmit.js - Texture mode note emission (chordBurst, flurry)
// for source and reflection channels.
// Extracted from playNotesEmitPick to keep the emission orchestrator focused.

/**
 * Emit texture-mode notes for a primary source channel.
 * @param {string} mode - 'chordBurst' or 'flurry'
 * @param {Object} ctx - emission context
 * @returns {number} additional scheduled event count
 */
emitPickSourceTextures = function(mode, ctx) {
  const { noteToEmit, texVel, onTick, tpUnit, texSustain, sourceCH, minMidi, maxMidi, sustainScale } = ctx;

  let scheduled = 0;

  if (mode === 'chordBurst') {
    let burstIntervals = [3, 4, 7];
    const scalePCs = harmonicContext.getField('scale');
    if (Array.isArray(scalePCs) && scalePCs.length > 1) {
      const rootPC = noteToEmit % 12;
      const derived = [];
      for (let scaleIndex = 0; scaleIndex < scalePCs.length; scaleIndex++) {
        const pc = typeof scalePCs[scaleIndex] === 'number' ? scalePCs[scaleIndex] % 12 : -1;
        if (pc < 0) continue;
        const interval = (pc - rootPC + 12) % 12;
        if (interval > 0) derived.push(interval);
      }
      if (derived.length >= 2) burstIntervals = derived;
    }
    const burstCount = ri(2, 3);
    for (let burstIndex = 0; burstIndex < burstCount; burstIndex++) {
      const interval = burstIntervals[burstIndex % burstIntervals.length] * (rf() < 0.3 ? -1 : 1);
      const burstNote = modClamp(noteToEmit + interval, minMidi, maxMidi);
      const burstVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.8, 1.0))));
      const burstStagger = tpUnit * rf(0.002, 0.01) * (burstIndex + 1);
      const burstOnEvt = { tick: onTick + burstStagger, type: 'on', vals: [sourceCH, burstNote, burstVel] };
      const burstOffEvt = { tick: onTick + burstStagger + texSustain * rf(0.8, 1.1), vals: [sourceCH, burstNote] };
      microUnitAttenuator.record(burstOnEvt, burstOffEvt, crossModulation);
      scheduled += 2;
    }
  }

  if (mode === 'flurry') {
    const flurryCount = ri(3, 5);
    const flurryDir = rf() < 0.5 ? 1 : -1;
    let flurryNote = noteToEmit;
    const flurryGap = tpUnit * rf(0.04, 0.09);

    let scalePitches = null;
    const scalePCs = harmonicContext.getField('scale');
    if (Array.isArray(scalePCs) && scalePCs.length > 1) {
      const lo = minMidi;
      const hi = maxMidi;
      const pitches = [];
      for (let oct = m.floor(lo / 12); oct <= m.ceil(hi / 12); oct++) {
        for (let scaleIndex = 0; scaleIndex < scalePCs.length; scaleIndex++) {
          const pc = typeof scalePCs[scaleIndex] === 'number' ? scalePCs[scaleIndex] % 12 : -1;
          if (pc < 0) continue;
          const midi = oct * 12 + pc;
          if (midi >= lo && midi <= hi) pitches.push(midi);
        }
      }
      if (pitches.length > 2) scalePitches = pitches.sort((a, b) => a - b);
    }

    for (let flurryIndex = 0; flurryIndex < flurryCount; flurryIndex++) {
      if (scalePitches) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let scaleIndex = 0; scaleIndex < scalePitches.length; scaleIndex++) {
          const diff = (scalePitches[scaleIndex] - flurryNote) * flurryDir;
          if (diff > 0 && diff < bestDist) {
            bestDist = diff;
            bestIdx = scaleIndex;
          }
        }
        flurryNote = bestIdx >= 0
          ? scalePitches[bestIdx]
          : modClamp(flurryNote + flurryDir * ri(1, 2), minMidi, maxMidi);
      } else {
        flurryNote = modClamp(flurryNote + flurryDir * ri(1, 2), minMidi, maxMidi);
      }

      const flurryVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.65, 0.95) * (1 - flurryIndex * 0.05))));
      const flurrySus = tpUnit * rf(0.08, 0.2) * sustainScale;
      const flurryOnTick = onTick + flurryGap * (flurryIndex + 1);
      const flurryOnEvt = { tick: flurryOnTick, type: 'on', vals: [sourceCH, flurryNote, flurryVel] };
      const flurryOffEvt = { tick: flurryOnTick + flurrySus, vals: [sourceCH, flurryNote] };
      microUnitAttenuator.record(flurryOnEvt, flurryOffEvt, crossModulation);
      scheduled += 2;
    }
  }

  return scheduled;
};

/**
 * Emit texture-mode notes for a primary reflection channel.
 * @param {string} mode - 'chordBurst' or 'flurry'
 * @param {Object} ctx - emission context
 * @returns {number} additional scheduled event count
 */
emitPickReflectionTextures = function(mode, ctx) {
  const { note, vel, onTick, tpUnit, sustain, ch, minMidi, maxMidi, velocityScale, sustainScale } = ctx;

  let scheduled = 0;

  if (mode === 'chordBurst') {
    const reflBurstCount = ri(1, 2);
    const echoIntervals = [3, 4, 7];
    for (let burstIndex = 0; burstIndex < reflBurstCount; burstIndex++) {
      const echoInterval = echoIntervals[burstIndex % echoIntervals.length] * (rf() < 0.3 ? -1 : 1);
      const echoNote = modClamp(note + echoInterval, minMidi, maxMidi);
      const echoVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(vel * rf(0.45, 0.65) * velocityScale)));
      const echoStagger = tpUnit * rf(0.01, 0.04) * (burstIndex + 1);
      const echoOnEvt = { tick: onTick + echoStagger, type: 'on', vals: [ch, echoNote, echoVel] };
      const echoOffEvt = { tick: onTick + echoStagger + sustain * sustainScale * rf(0.6, 0.9), vals: [ch, echoNote] };
      microUnitAttenuator.record(echoOnEvt, echoOffEvt, crossModulation);
      scheduled += 2;
    }
  }

  if (mode === 'flurry') {
    const ghostDir = rf() < 0.5 ? 1 : -1;
    const ghostNote = modClamp(note + ghostDir * ri(1, 3), minMidi, maxMidi);
    const ghostVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(vel * rf(0.35, 0.55))));
    const ghostDelay = tpUnit * rf(0.06, 0.14);
    const ghostSus = tpUnit * rf(0.1, 0.25) * sustainScale;
    const ghostOnEvt = { tick: onTick + ghostDelay, type: 'on', vals: [ch, ghostNote, ghostVel] };
    const ghostOffEvt = { tick: onTick + ghostDelay + ghostSus, vals: [ch, ghostNote] };
    microUnitAttenuator.record(ghostOnEvt, ghostOffEvt, crossModulation);
    scheduled += 2;
  }

  return scheduled;
};
