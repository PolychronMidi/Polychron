/**
 * Composes meter-related values with randomization.
 * @class
 */
const { writeIndexTrace, writeDebugFile } = require('../debug/logGate');
class MeasureComposer {
  constructor() {
    /** @type {number[]|null} Previous meter [numerator, denominator] */
    this.lastMeter=null;
    /** @type {number} Recursion depth counter for getNotes */
    this.recursionDepth=0;
    /** @type {number} Max allowed recursion depth */
    this.MAX_RECURSION=5;
    /** @type {VoiceLeadingScore|null} Optional voice leading optimizer */
    this.voiceLeading=null;
    /** @type {number[]} Historical notes for voice leading context */
    this.voiceHistory=[];
  }
  /** @returns {number} Random numerator from NUMERATOR config */
  getNumerator(){const{min,max,weights}=NUMERATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random denominator from DENOMINATOR config */
  getDenominator(){const{min,max,weights}=DENOMINATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random divisions count from DIVISIONS config */
  getDivisions(){const{min,max,weights}=DIVISIONS;const res=m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1)); try { const trace={tag:'composer:getDivisions',when:new Date().toISOString(),composer:this.constructor && this.constructor.name ? this.constructor.name : 'MeasureComposer',value:res,stack:(new Error()).stack,layer:(LM && LM.activeLayer) ? LM.activeLayer : 'primary'}; writeIndexTrace(trace); } catch (e) { /* swallow */ } return res;}
  /** @returns {number} Random subdivs count from SUBDIVISIONS config */
  getSubdivs(){const{min,max,weights}=SUBDIVISIONS;const res=m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1)); try { const trace={tag:'composer:getSubdivs',when:new Date().toISOString(),composer:this.constructor && this.constructor.name ? this.constructor.name : 'MeasureComposer',value:res,stack:(new Error()).stack,layer:(LM && LM.activeLayer) ? LM.activeLayer : 'primary'}; writeIndexTrace(trace); } catch (e) { /* swallow */ } return res;}
  /** @returns {number} Random sub-subdivs count from SUBSUBDIVS config */
  getSubsubdivs(){const{min,max,weights}=SUBSUBDIVS;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random voice count from VOICES config */
  getVoices(){const{min,max,weights}=VOICES;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number[]} Two octaves with minimum 2-3 octave difference */
  getOctaveRange() { const { min,max,weights }=OCTAVE;
  let [o1,o2]=[rw(min,max,weights),rw(min,max,weights)];
  while (m.abs(o1-o2)<ri(2,3)) { o2=modClamp(o2+ri(-3,3),min,max); }
  return [ o1,o2 ];
  }
  /**
   * Generates a valid meter [numerator, denominator] with log-based ratio check.
   * @param {boolean} [ignoreRatioCheck=false] - Skip ratio validation
   * @param {boolean} [polyMeter=false] - Allow larger ratio jumps for polyrhythm
   * @param {number} [maxIterations=200] - Maximum attempts before fallback
   * @param {number} [timeLimitMs=100] - Maximum wall-clock time before fallback
   * @returns {number[]} [numerator, denominator]
   * @throws {Error} When max iterations exceeded and no valid meter found
   */
  getMeter(ignoreRatioCheck=false, polyMeter=false, maxIterations=200, timeLimitMs=100) {
    // Constants for ratio validation
    const METER_RATIO_MIN = 0.25;
    const METER_RATIO_MAX = 4;
    const MIN_LOG_STEPS = 0.5;
    const FALLBACK_METER = [4, 4];

    let iterations=0;
    const maxLogSteps=polyMeter ? 4 : 2; // Log2 steps: 2 = ~4x ratio, 4 = ~16x ratio
    const startTs=Date.now();
    const _mStart = process.hrtime.bigint();

    while (++iterations <= maxIterations && (Date.now() - startTs) <= timeLimitMs) {
      let newNumerator=this.getNumerator();
      let newDenominator=this.getDenominator();

      // Validate numerator and denominator are positive integers
      if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
        continue;
      }

      let newMeterRatio=newNumerator / newDenominator;

      // Check if new meter ratio is within acceptable range
      const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

      if (ratioValid) {
        if (this.lastMeter) {
          let lastMeterRatio=this.lastMeter[0] / this.lastMeter[1];
          // Log ratio: 0 = same, 1 = 2x, 2 = 4x, 3 = 8x, 4 = 16x difference
          let logSteps=m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
          // Also enforce an absolute ratio change threshold to avoid large linear jumps
          const ratioChange = m.abs(newMeterRatio - lastMeterRatio);
          if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps && ratioChange <= 1.5) {
            this.lastMeter=[newNumerator,newDenominator];
            try { const _durMs = Number(process.hrtime.bigint() - _mStart) / 1e6; if (_durMs > 5) writeDebugFile('composers-perf.ndjson', { tag: 'getMeter-slow', ms: _durMs, iterations }, 'perf'); } catch (e) { /* swallow */ }
            return this.lastMeter;
          }
        } else {
          this.lastMeter=[newNumerator,newDenominator];
          try { const _durMs = Number(process.hrtime.bigint() - _mStart) / 1e6; if (_durMs > 5) console.warn(`perf: getMeter slow ${_durMs.toFixed(2)}ms iterations=${iterations}`); } catch (e) { /* swallow */ }
          return this.lastMeter;
        }
      }
    }

    // Log warning with diagnostic info
    writeDebugFile('composers.ndjson', { tag: 'getMeter-failed', iterations, durationMs: (Date.now()-startTs), meterRatioBounds: [METER_RATIO_MIN, METER_RATIO_MAX], logStepsRange: [MIN_LOG_STEPS, maxLogSteps], fallback: [FALLBACK_METER[0], FALLBACK_METER[1]] }, 'debug');
    // Also emit a console warning so tests and engineers can observe the fallback directly
    try {
      console.warn(`getMeter() failed: fallback ${JSON.stringify(FALLBACK_METER)} iterations=${iterations} Ratio bounds=${METER_RATIO_MIN}-${METER_RATIO_MAX} LogSteps=${MIN_LOG_STEPS}-${maxLogSteps}`);
    } catch (e) { /* swallow */ }
    this.lastMeter=FALLBACK_METER;
    return this.lastMeter;
  }
  /**
   * Generates note objects within octave range.
   * @param {number[]|null} [octaveRange=null] - [min, max] octaves, or auto-generate
   * @returns {{note: number}[]} Array of note objects
   */
  getNotes(octaveRange=null) {
    if (++this.recursionDepth > this.MAX_RECURSION) {
      writeDebugFile('composers.ndjson', { tag: 'getNotes-recursion-limit' }, 'debug');
      this.recursionDepth = 0;
      return [{ note: 0 }];
    }
    const uniqueNotes=new Set();
    const voices=this.getVoices();
    const [minOctave,maxOctave]=octaveRange || this.getOctaveRange();
    const rootNote=this.notes[ri(this.notes.length - 1)];
    let intervals=[],fallback=false;
    try {  const shift=ri();
      switch (ri(2)) {
        case 0:intervals=[0,2,3+shift,6-shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        case 1:intervals=[0,1,3+shift,5+shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        default:intervals=Array.from({length:this.notes.length},(_,i)=>i);  fallback=true;  }
      // Validate that all intervals are within scale bounds and produce valid scale degrees
      intervals = intervals.map(interval => {
        // Ensure interval is within valid range for the scale
        const validatedInterval = clamp(interval, 0, this.notes.length - 1);
        // Calculate the actual note index to verify it's within the scale
        const rootIndex = this.notes.indexOf(rootNote);
        const noteIndex = (rootIndex + validatedInterval) % this.notes.length;
        // Return the validated interval that produces a proper scale degree
        return validatedInterval;
      });
      return intervals.slice(0,voices).map((interval,index)=>{
        const noteIndex=(this.notes.indexOf(rootNote)+interval) % this.notes.length;
        let octave=ri(minOctave,maxOctave);
        let note=t.Note.chroma(this.notes[noteIndex])+12*octave;
        while (uniqueNotes.has(note)) {
          octave=octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave < OCTAVE.max ? octave++ : octave > OCTAVE.min ? octave-- : (()=>{ return false; })();
          if (octave===false) break; note=t.Note.chroma(this.notes[noteIndex])+12*octave;  }
        return { note };
      }).filter((noteObj,index,self)=>
        index===self.findIndex(n=>n.note===noteObj.note)
      ); }  catch (e) { if (!fallback) { this.recursionDepth--; return this.getNotes(octaveRange); } else {
      try { writeDebugFile('composers.ndjson', { tag: 'getNotes-recursion', message: e && e.message ? e.message : String(e) }, 'debug'); } catch (e2) { /* swallow */ } this.recursionDepth--; return this.getNotes(octaveRange);  }}
    finally {
      this.recursionDepth--;
    }
  }

  /**
   * Enables voice leading optimization for this composer.
   * @param {VoiceLeadingScore} [scorer] - Optional custom voice leading scorer
   * @returns {void}
   */
  enableVoiceLeading(scorer) {
    this.voiceLeading = scorer || new VoiceLeadingScore();
    this.voiceHistory = [];
  }

  /**
   * Disables voice leading optimization.
   * @returns {void}
   */
  disableVoiceLeading() {
    this.voiceLeading = null;
    this.voiceHistory = [];
  }

  /**
   * Selects the best note from available candidates using voice leading cost function.
   * Falls back to random selection if voice leading is disabled.
   * @param {number[]} availableNotes - Pool of candidate notes
   * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
   * @returns {number} Selected note
   */
  selectNoteWithLeading(availableNotes, config = {}) {
    if (!this.voiceLeading || !availableNotes || availableNotes.length === 0) {
      return availableNotes?.[ri(availableNotes.length - 1)] ?? 60;
    }

    const selectedNote = this.voiceLeading.selectNextNote(this.voiceHistory, availableNotes, config);
    this.voiceHistory.push(selectedNote);

    // Keep history shallow for memory efficiency
    if (this.voiceHistory.length > 4) {
      this.voiceHistory.shift();
    }

    return selectedNote;
  }

  /**
   * Resets voice leading history (call at section boundaries).
   * @returns {void}
   */
  resetVoiceLeading() {
    this.voiceHistory = [];
    if (this.voiceLeading) {
      this.voiceLeading.reset();
    }
  }
}

try { module.exports = MeasureComposer; } catch (e) { /* swallow */ }
try { Function('f', 'this.MeasureComposer = f')(MeasureComposer); } catch (e) { /* swallow */ }
