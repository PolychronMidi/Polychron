// instrumentation.js - functions for setting and updating instruments and tunings.

/**
 * Sets program, pitch bend, and volume for all instrument channels
 * @returns {void}
 */
setTuningAndInstruments = () => {
  const instrEvents1 = ['control_c','program_c'].flatMap(type=>[ ...source.map(ch=>({
  timeInSeconds:measureStartTime,type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [primaryInstrument]) : (type==='control_c' ? [10,127] : [primaryInstrument]))]})),
  { timeInSeconds:measureStartTime,type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH1,...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { timeInSeconds:measureStartTime,type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH2,...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]);
  for (let _i=0;_i<instrEvents1.length;_i++){ const _ev=instrEvents1[_i]; if (_ev && _ev.type==='control_c' && Array.isArray(_ev.vals)) { channelStateField.observeControl(_ev.vals[0], _ev.vals[1], _ev.vals[2], 'instrumentation'); } }
  p(c,...instrEvents1);
  const instrEvents2 = ['control_c','program_c'].flatMap(type=>[ ...bass.map(ch=>({
    timeInSeconds:measureStartTime,type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [bassInstrument]) : (type==='control_c' ? [10,127] : [bassInstrument2]))]})),
    { timeInSeconds:measureStartTime,type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH3,...(type==='control_c' ? [tuningPitchBend] : [bassInstrument])]}]);
  for (let _i=0;_i<instrEvents2.length;_i++){ const _ev=instrEvents2[_i]; if (_ev && _ev.type==='control_c' && Array.isArray(_ev.vals)) { channelStateField.observeControl(_ev.vals[0], _ev.vals[1], _ev.vals[2], 'instrumentation'); } }
  p(c,...instrEvents2);
  source.forEach(ch => channelStateField.observeControl(ch, 7, 104, 'instrumentation'));
  reflection.forEach(ch => channelStateField.observeControl(ch, 7, 100, 'instrumentation'));
  bass.forEach(ch => channelStateField.observeControl(ch, 7, 102, 'instrumentation'));
  channelStateField.observeControl(drumCH, 7, 104, 'instrumentation');
  channelStateField.observeControl(0, 127, 0, 'instrumentation');
  p(c,
    ...source.map(ch => ({ timeInSeconds: measureStartTime, type: 'control_c', vals: [ch, 7, 104] })),
    ...reflection.map(ch => ({ timeInSeconds: measureStartTime, type: 'control_c', vals: [ch, 7, 100] })),
    ...bass.map(ch => ({ timeInSeconds: measureStartTime, type: 'control_c', vals: [ch, 7, 102] })),
    { timeInSeconds: measureStartTime, type:'control_c', vals:[drumCH, 7, 104] },
    // poly operation
    { timeInSeconds: measureStartTime, type: 'control_c', vals: [0, 127, 0] }
  );
          p(c, );
}

/**
 * Randomly updates binaural beat instruments and FX on timed shifts
 * @returns {void}
 */
let nextInstrumentShiftMs = 0;
setOtherInstruments = () => {
  const absoluteSeconds = beatStartTime;
  const timedShift = absoluteSeconds * 1000 >= nextInstrumentShiftMs;
  if (firstLoop < 1 || timedShift) {
    nextInstrumentShiftMs = absoluteSeconds * 1000 + rf(2, 5) * 1000;
const bassProgramPool = Array.isArray(otherBassInstruments)
  ? otherBassInstruments.filter(program => Number.isFinite(Number(program)) && ((Number(program) >= 32 && Number(program) <= 39) || Number(program) === 43))
  : [];
const resolvedBassProgramPool = bassProgramPool.length > 0
  ? bassProgramPool
  : [bassInstrument, bassInstrument2].filter(program => Number.isFinite(Number(program)));
    // Bias instrument selection away from other layer's current programs
    const otherLayer = crossLayerHelpers.getOtherLayer(LM.activeLayer || 'L1');
    const otherInst = L0.getLast(L0_CHANNELS.instrument, { layer: otherLayer });
    const otherPrograms = otherInst && Array.isArray(otherInst.programs) ? otherInst.programs : [];
    const gmFamily = (pg) => m.floor(Number(pg) / 8);
    const biasedOtherInstruments = otherPrograms.length > 0
      ? otherInstruments.filter(pg => !otherPrograms.some(op => gmFamily(pg) === gmFamily(op))) : [];
    const instrumentPool = biasedOtherInstruments.length > 2 ? biasedOtherInstruments : otherInstruments;
    // Trust-driven timbre: if trust ecology suggests a program, use it
    const trustSuggestion = safePreBoot.call(() => trustTimbreMapping.suggest(absoluteSeconds), null);
    // R25: regime-timbre-link - regime changes bias reflection instrument toward
    // regime-appropriate families (coherent=pads, exploring=synths, evolving=strings)
    const REGIME_REFLECTION_POOLS = { coherent: [89, 92, 97, 98], exploring: [79, 81, 104, 112], evolving: [48, 49, 50, 51] };
    const currentRegimeForTimbre = /** @type {string} */ (regimeClassifier.getRegime());
    const regimePool = REGIME_REFLECTION_POOLS[currentRegimeForTimbre];
    const regimeSuggestion = regimePool && rf() < 0.35 ? regimePool[ri(regimePool.length - 1)] : null;
    const selectedReflection = Number.isFinite(trustSuggestion) ? trustSuggestion
      : Number.isFinite(regimeSuggestion) ? regimeSuggestion
      : ra(instrumentPool);
    const selectedBass = ra(resolvedBassProgramPool);
    const selectedDrum = ra(drumSets);
p(c,...['control_c'].flatMap(()=>{ const tmp={ timeInSeconds:beatStartTime,type:'program_c' };
  return [
    ...reflectionBinaural.map(ch=>({...tmp,vals:[ch,selectedReflection]})),
    ...bassBinaural.map(ch=>({...tmp,vals:[ch,selectedBass]})),
    { ...tmp,vals:[drumCH,selectedDrum] }
  ];  })  );
    L0.post(L0_CHANNELS.instrument, LM.activeLayer || 'shared', beatStartTime, { programs: [selectedReflection, selectedBass, selectedDrum] });
  }
}

/**
 * Send All Notes Off CC (123) to prevent sustain across transitions.
 * @param {number} [timeInSeconds=measureStartTime] - Time position for All Notes Off.
 * @returns {Array} Array of CC events.
 */
allNotesOff=(timeInSeconds=measureStartTime)=>{allCHs.forEach(ch => channelStateField.observeControl(ch, 123, 0, 'instrumentation')); return p(c,...allCHs.map(ch=>({timeInSeconds,type:'control_c',vals:[ch,123,0]  })));}

/**
 * Send Mute All CC (120) to silence all channels.
 * @param {number} [timeInSeconds=measureStartTime] - Time position for Mute All.
 * @returns {Array} Array of CC events.
 */
muteAll=(timeInSeconds=measureStartTime)=>{allCHs.forEach(ch => channelStateField.observeControl(ch, 120, 0, 'instrumentation')); return p(c,...allCHs.map(ch=>({timeInSeconds,type:'control_c',vals:[ch,120,0]  })));}

/**
 * Neutral pitch bend value (center of pitch bend range).
 * @type {number}
 */
neutralPitchBend=8192;

/**
 * Semitone value in pitch bend units.
 * @type {number}
 */
semitone=neutralPitchBend / 2;
TUNING_FREQ=432; // Reference tuning frequency (can be overridden by conductor profile)
/**
 * Convert cents to tuning frequency offset.
 * @type {number}
 */
const centsToTuningFreq = 1200 * m.log2(TUNING_FREQ / 440);

/**
 * Pitch bend value for tuning frequency.
 * @type {number}
 */
tuningPitchBend=m.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

BINAURAL={min:0.75,max:2.25}; // Binaural beat frequency range in Hz (can be overridden by conductor profile)
/**
 * Generate binaural frequency offset.
 * @type {number}
 */
binauralFreqOffset = rf(BINAURAL.min, BINAURAL.max);

/**
 * Calculate binaural offset pitch bend values.
 * @param {number} plusOrMinus - Direction multiplier (+1 or -1).
 * @returns {number} Pitch bend value.
 */
binauralOffset=(plusOrMinus)=>{
  return m.round(tuningPitchBend + semitone * (12 * m.log2((TUNING_FREQ + plusOrMinus * binauralFreqOffset) / TUNING_FREQ)));
};

/**
 * Binaural pitch bend values for + and - frequencies.
 * @type {number[]}
 */
[binauralPlus,binauralMinus]=[1,-1].map(binauralOffset);
