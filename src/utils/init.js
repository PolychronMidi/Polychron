// init.js - global initialization.




// Timing and counter variables (documented inline for brevity)
measureCount=spMeasure=subsubdivStart=subdivStart=beatStart=divStart=sectionStart=sectionStartTime=sectionEnd=tpMeasure=tpBeat=tpDiv=tpSubdiv=tpSubsubdiv=subdivStartTime=subsubdivStartTime=tpSubsubdiv=tpSection=spSection=finalTick=bestMatch=polyMeterRatio=polyNumerator=tpSec=finalTime=endTime=phraseStart=tpPhrase1=tpPhrase2=phraseStartTime=spPhrase=measuresPerPhrase=measuresPerPhrase1=measuresPerPhrase1=measuresPerPhrase2=subdivsPerMinute=subsubsPerMinute=numerator=denominator=subsubsPerSub=meterRatio=divsPerBeat=subdivsPerBeat=subdivsPerDiv=measureStart=measureStartTime=beatsUntilBinauralShift=beatCount=beatsOn=beatsOff=divsOn=divsOff=subdivsOn=subdivsOff=subsubdivsOn=subsubdivsOff=noteCount=beatRhythm=divRhythm=subdivRhythm=subsubdivRhythm=subsubsPerSub=balOffset=sideBias=firstLoop=lastCrossMod=bpmRatio=sectionIndex=phraseIndex=phrasesPerSection=totalSections=measureIndex=beatIndex=divIndex=subdivIndex=subsubdivIndex=0;

composer = null; activeMotif = null; currentSectionType = null; currentSectionDynamics = null;

/**
 * Cross-modulation factor for polyrhythmic interference.
 * @type {number}
 */
crossModulation=2.2;

/**
 * Last used meter configuration.
 * @type {number[]}
 */
lastMeter=[4,4];

/**
 * Sets tracking used MIDI channels to avoid repetition.
 * @type {Set<number>}
 */
lastUsedCHs=new Set();
lastUsedCHs2=new Set();
lastUsedCHs3=new Set();

/**
 * Default MIDI velocity.
 * @type {number}
 */
velocity=99;

/**
 * Toggle for binaural beat channel flip.
 * @type {boolean}
 */
flipBin=false;

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

/**
 * Convert cents to tuning frequency offset.
 * @type {number}
 */
let centsToTuningFreq = 1200 * m.log2(TUNING_FREQ / 440);

/**
 * Pitch bend value for tuning frequency.
 * @type {number}
 */
tuningPitchBend=m.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

/**
 * Generate binaural frequency offset.
 * @type {number}
 */
let binauralFreqOffset = rf(BINAURAL.min, BINAURAL.max);

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

/**
 * MIDI channel constants for center channels.
 * @type {number}
 */
cCH1=0;cCH2=1;lCH1=2;rCH1=3;lCH3=4;rCH3=5;lCH2=6;rCH2=7;lCH4=8;drumCH=9;rCH4=10;cCH3=11;lCH5=12;rCH5=13;lCH6=14;rCH6=15;

/**
 * Bass channel assignments.
 * @type {number[]}
 */
bass=[cCH3,lCH5,rCH5,lCH6,rCH6];

/**
 * Bass channels for binaural processing.
 * @type {number[]}
 */
bassBinaural=[lCH5,rCH5,lCH6,rCH6];

/**
 * Primary source channel assignments.
 * @type {number[]}
 */
source=[cCH1,lCH1,lCH2,rCH1,rCH2];

/**
 * Extended source channels including drums.
 * @type {number[]}
 */
source2=[cCH1,lCH1,lCH2,rCH1,rCH2,drumCH];

/**
 * Reflection channel assignments (creates space/depth).
 * @type {number[]}
 */
reflection=[cCH2,lCH3,lCH4,rCH3,rCH4];

/**
 * Reflection channels for binaural processing.
 * @type {number[]}
 */
reflectionBinaural=[lCH3,lCH4,rCH3,rCH4];

/**
 * Source-to-reflection channel mapping (first reflection layer).
 * @type {Object.<number, number>}
 */
reflect={[cCH1]:cCH2,[lCH1]:lCH3,[rCH1]:rCH3,[lCH2]:lCH4,[rCH2]:rCH4};

/**
 * Source-to-reflection channel mapping (second reflection layer).
 * @type {Object.<number, number>}
 */
reflect2={[cCH1]:cCH3,[lCH1]:lCH5,[rCH1]:rCH5,[lCH2]:lCH6,[rCH2]:rCH6};

/**
 * Left channel assignments for binaural beats.
 * @type {number[]}
 */
binauralL=[lCH1,lCH2,lCH3,lCH4,lCH5,lCH6];

/**
 * Right channel assignments for binaural beats.
 * @type {number[]}
 */
binauralR=[rCH1,rCH2,rCH3,rCH4,rCH5,rCH6];

/**
 * Flip binaural mapping (front configuration).
 * @type {number[]}
 */
flipBinF=[cCH1,cCH2,cCH3,lCH1,rCH1,lCH3,rCH3,lCH5,rCH5];

/**
 * Flip binaural mapping (top configuration).
 * @type {number[]}
 */
flipBinT=[cCH1,cCH2,cCH3,lCH2,rCH2,lCH4,rCH4,lCH6,rCH6];

/**
 * Flip binaural mapping (front config, 2nd layer).
 * @type {number[]}
 */
flipBinF2=[lCH1,rCH1,lCH3,rCH3,lCH5,rCH5];

/**
 * Flip binaural mapping (top config, 2nd layer).
 * @type {number[]}
 */
flipBinT2=[lCH2,rCH2,lCH4,rCH4,lCH6,rCH6];

/**
 * Flip binaural mapping (front config, 3rd layer).
 * @type {number[]}
 */
flipBinF3=[cCH2,cCH3,lCH1,rCH1,lCH3,rCH3,lCH5,rCH5];

/**
 * Flip binaural mapping (top config, 3rd layer).
 * @type {number[]}
 */
flipBinT3=[cCH2,cCH3,lCH2,rCH2,lCH4,rCH4,lCH6,rCH6];

/**
 * Channels available for stutter fade effects.
 * @type {number[]}
 */
stutterFadeCHs=[cCH2,cCH3,lCH1,rCH1,lCH2,rCH2,lCH3,rCH3,lCH4,rCH4,lCH5,rCH5,lCH6,rCH6];

/**
 * All available MIDI channels.
 * @type {number[]}
 */
allCHs=[cCH1,cCH2,cCH3,lCH1,rCH1,lCH2,rCH2,lCH3,rCH3,lCH4,rCH4,lCH5,rCH5,lCH6,rCH6,drumCH];

/**
 * Channels for stutter pan effects.
 * @type {number[]}
 */
stutterPanCHs=[cCH1,cCH2,cCH3,drumCH];

/**
 * MIDI CC effect numbers supported.
 * @type {number[]}
 */
FX=[1,5,11,65,67,68,69,70,71,72,73,74,91,92,93,94,95];

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
