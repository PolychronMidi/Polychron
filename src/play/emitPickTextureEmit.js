// emitPickTextureEmit.js - Texture mode note emission (chordBurst, flurry)
// for source and reflection channels.
// Extracted from playNotesEmitPick to keep the emission orchestrator focused.

let emitPickTextureEmitScaleSignature = '';
let emitPickTextureEmitNormalizedScale = null;
let emitPickTextureEmitBurstIntervalCache = {};
let emitPickTextureEmitScalePitchCache = {};
const EMIT_PICK_TEXTURE_PROFILE = process.argv.includes('--trace');

function emitPickTextureEmitNormalizeScale() {
  const scalePCs = harmonicContext.getField('scale');
  if (!Array.isArray(scalePCs) || scalePCs.length <= 1) return null;

  const normalized = [];
  const seen = new Set();
  for (let scaleIndex = 0; scaleIndex < scalePCs.length; scaleIndex++) {
    const rawPc = scalePCs[scaleIndex];
    if (typeof rawPc !== 'number') continue;
    const pc = ((rawPc % 12) + 12) % 12;
    if (seen.has(pc)) continue;
    seen.add(pc);
    normalized.push(pc);
  }
  if (normalized.length <= 1) return null;
  normalized.sort((a, b) => a - b);
  return normalized;
}

function emitPickTextureEmitGetScale() {
  const normalized = emitPickTextureEmitNormalizeScale();
  if (!normalized) return null;
  const signature = normalized.join(',');
  if (signature !== emitPickTextureEmitScaleSignature) {
    emitPickTextureEmitScaleSignature = signature;
    emitPickTextureEmitNormalizedScale = normalized;
    emitPickTextureEmitBurstIntervalCache = {};
    emitPickTextureEmitScalePitchCache = {};
  }
  return emitPickTextureEmitNormalizedScale;
}

function emitPickTextureEmitGetBurstIntervals(noteToEmit) {
  const normalizedScale = emitPickTextureEmitGetScale();
  if (!normalizedScale) return [3, 4, 7];

  const rootPC = ((noteToEmit % 12) + 12) % 12;
  const cached = emitPickTextureEmitBurstIntervalCache[rootPC];
  if (cached) return cached;

  const derived = [];
  for (let scaleIndex = 0; scaleIndex < normalizedScale.length; scaleIndex++) {
    const interval = (normalizedScale[scaleIndex] - rootPC + 12) % 12;
    if (interval > 0) derived.push(interval);
  }
  const burstIntervals = derived.length >= 2 ? derived : [3, 4, 7];
  emitPickTextureEmitBurstIntervalCache[rootPC] = burstIntervals;
  return burstIntervals;
}

function emitPickTextureEmitGetScalePitches(minMidi, maxMidi) {
  const normalizedScale = emitPickTextureEmitGetScale();
  if (!normalizedScale) return null;

  const cacheKey = `${minMidi}:${maxMidi}`;
  if (Object.prototype.hasOwnProperty.call(emitPickTextureEmitScalePitchCache, cacheKey)) {
    return emitPickTextureEmitScalePitchCache[cacheKey];
  }

  const pitches = [];
  for (let oct = m.floor(minMidi / 12); oct <= m.ceil(maxMidi / 12); oct++) {
    for (let scaleIndex = 0; scaleIndex < normalizedScale.length; scaleIndex++) {
      const midi = oct * 12 + normalizedScale[scaleIndex];
      if (midi >= minMidi && midi <= maxMidi) pitches.push(midi);
    }
  }
  const result = pitches.length > 2 ? pitches : null;
  emitPickTextureEmitScalePitchCache[cacheKey] = result;
  return result;
}

/**
 * Emit texture-mode notes for a primary source channel.
 * @param {string} mode - 'chordBurst' or 'flurry'
 * @param {Object} ctx - emission context
 * @returns {number} additional scheduled event count
 */
emitPickSourceTextures = function(mode, ctx) {
  const emitPickTextureStartedAt = EMIT_PICK_TEXTURE_PROFILE ? process.hrtime.bigint() : 0n;
  const { noteToEmit, texVel, onTick, tpUnit, texSustain, sourceCH, minMidi, maxMidi, sustainScale } = ctx;

  let scheduled = 0;

  if (mode === 'chordBurst') {
    const burstIntervals = emitPickTextureEmitGetBurstIntervals(noteToEmit);
    const burstCount = ri(2, 3);
    for (let burstIndex = 0; burstIndex < burstCount; burstIndex++) {
      const interval = burstIntervals[burstIndex % burstIntervals.length] * (rf() < 0.3 ? -1 : 1);
      const burstNote = modClamp(noteToEmit + interval, minMidi, maxMidi);
      const burstVel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(texVel * rf(0.8, 1.0))));
      const burstStagger = tpUnit * rf(0.002, 0.01) * (burstIndex + 1);
      const burstOnTick = onTick + burstStagger;
      const burstOffTick = minimumNoteDuration.resolveOffTick(
        burstOnTick,
        burstOnTick + texSustain * rf(0.8, 1.1),
        'ornament',
        tpUnit,
        'emitPickTextureEmit.burstOffTick'
      );
      const burstOnEvt = { tick: burstOnTick, type: 'on', vals: [sourceCH, burstNote, burstVel] };
      const burstOffEvt = { tick: burstOffTick, vals: [sourceCH, burstNote] };
      microUnitAttenuator.record(burstOnEvt, burstOffEvt, crossModulation);
      scheduled += 2;
    }
  }

  if (mode === 'flurry') {
    const flurryCount = ri(3, 5);
    const flurryDir = rf() < 0.5 ? 1 : -1;
    let flurryNote = noteToEmit;
    const flurryGap = tpUnit * rf(0.04, 0.09);
    const scalePitches = emitPickTextureEmitGetScalePitches(minMidi, maxMidi);

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
      const flurryOffTick = minimumNoteDuration.resolveOffTick(
        flurryOnTick,
        flurryOnTick + flurrySus,
        'ornament',
        tpUnit,
        'emitPickTextureEmit.flurryOffTick'
      );
      const flurryOnEvt = { tick: flurryOnTick, type: 'on', vals: [sourceCH, flurryNote, flurryVel] };
      const flurryOffEvt = { tick: flurryOffTick, vals: [sourceCH, flurryNote] };
      microUnitAttenuator.record(flurryOnEvt, flurryOffEvt, crossModulation);
      scheduled += 2;
    }
  }

  if (EMIT_PICK_TEXTURE_PROFILE) traceDrain.recordRuntimeMetric(`emitPickSourceTextures.${mode}`, Number(process.hrtime.bigint() - emitPickTextureStartedAt) / 1e6);
  return scheduled;
};

/**
 * Emit texture-mode notes for a primary reflection channel.
 * @param {string} mode - 'chordBurst' or 'flurry'
 * @param {Object} ctx - emission context
 * @returns {number} additional scheduled event count
 */
emitPickReflectionTextures = function(mode, ctx) {
  const emitPickTextureStartedAt = EMIT_PICK_TEXTURE_PROFILE ? process.hrtime.bigint() : 0n;
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
      const echoOnTick = onTick + echoStagger;
      const echoOffTick = minimumNoteDuration.resolveOffTick(
        echoOnTick,
        echoOnTick + sustain * sustainScale * rf(0.6, 0.9),
        'ornament',
        tpUnit,
        'emitPickTextureEmit.echoOffTick'
      );
      const echoOnEvt = { tick: echoOnTick, type: 'on', vals: [ch, echoNote, echoVel] };
      const echoOffEvt = { tick: echoOffTick, vals: [ch, echoNote] };
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
    const ghostOnTick = onTick + ghostDelay;
    const ghostOffTick = minimumNoteDuration.resolveOffTick(
      ghostOnTick,
      ghostOnTick + ghostSus,
      'ornament',
      tpUnit,
      'emitPickTextureEmit.ghostOffTick'
    );
    const ghostOnEvt = { tick: ghostOnTick, type: 'on', vals: [ch, ghostNote, ghostVel] };
    const ghostOffEvt = { tick: ghostOffTick, vals: [ch, ghostNote] };
    microUnitAttenuator.record(ghostOnEvt, ghostOffEvt, crossModulation);
    scheduled += 2;
  }

  if (EMIT_PICK_TEXTURE_PROFILE) traceDrain.recordRuntimeMetric(`emitPickReflectionTextures.${mode}`, Number(process.hrtime.bigint() - emitPickTextureStartedAt) / 1e6);
  return scheduled;
};
