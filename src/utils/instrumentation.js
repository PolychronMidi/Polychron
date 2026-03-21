// instrumentation.js - functions for setting and updating instruments and tunings.

/**
 * Sets program, pitch bend, and volume for all instrument channels
 * @returns {void}
 */
setTuningAndInstruments = () => {
  p(c,...['control_c','program_c'].flatMap(type=>[ ...source.map(ch=>({
  type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [primaryInstrument]) : (type==='control_c' ? [10,127] : [primaryInstrument]))]})),
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH1,...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH2,...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));
  p(c,...['control_c','program_c'].flatMap(type=>[ ...bass.map(ch=>({
    type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [bassInstrument]) : (type==='control_c' ? [10,127] : [bassInstrument2]))]})),
    { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH3,...(type==='control_c' ? [tuningPitchBend] : [bassInstrument])]}]));
  p(c,{type:'control_c', vals:[drumCH, 7, 127]});
}

/**
 * Randomly updates binaural beat instruments and FX on beat shifts
 * @returns {void}
 */
setOtherInstruments = () => {
  const absTimeMs = beatStartTime * 1000;
  const nextInstrumentShiftMs = absTimeMs + rf(2, 5) * 1000;
  if (rf() < .3 || absTimeMs >= nextInstrumentShiftMs || firstLoop<1 ) {
p(c,...['control_c'].flatMap(()=>{ const tmp={ tick:beatStart,type:'program_c' };
  return [
    ...reflectionBinaural.map(ch=>({...tmp,vals:[ch,ra(otherInstruments)]})),
    ...bassBinaural.map(ch=>({...tmp,vals:[ch,ra(otherBassInstruments)]})),
    { ...tmp,vals:[drumCH,ra(drumSets)] }
  ];  })  );  }
}

/**
 * Send All Notes Off CC (123) to prevent sustain across transitions.
 * @param {number} [tick=measureStart] - Tick position for All Notes Off.
 * @returns {Array} Array of CC events.
 */
allNotesOff=(tick=measureStart)=>{return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,123,0]  })));}

/**
 * Send Mute All CC (120) to silence all channels.
 * @param {number} [tick=measureStart] - Tick position for Mute All.
 * @returns {Array} Array of CC events.
 */
muteAll=(tick=measureStart)=>{return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,120,0]  })));}

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

BINAURAL={min:0.5,max:3}; // Binaural beat frequency range in Hz (can be overridden by conductor profile)
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
