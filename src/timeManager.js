// Time Manager - Handles all timing calculations and meter spoofing
import { MathUtils } from './mathUtils.js';

export class TimeManager {
  constructor(config = {}) {
    this.config = config;
    this.cache = new Map();
  }

  /**
   * Core meter spoofing functionality - converts any time signature to MIDI-compatible format
   */
  getMidiMeter(numerator, denominator) {
    const cacheKey = `${numerator}/${denominator}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const result = this.calculateMidiMeter(numerator, denominator);
    this.cache.set(cacheKey, result);
    return result;
  }

  calculateMidiMeter(numerator, denominator) {
    if (!numerator || !denominator) {
      throw new Error(`Invalid numerator (${numerator}) or denominator (${denominator})`);
    }
    const meterRatio = numerator / denominator;
    
    if (this.isPowerOf2(denominator)) {
      return {
        midiMeter: [numerator, denominator],
        meterRatio,
        midiMeterRatio: meterRatio,
        syncFactor: 1
      };
    }

    // Find nearest power of 2 for denominator
    const high = 2 ** Math.ceil(Math.log2(denominator));
    const low = 2 ** Math.floor(Math.log2(denominator));
    
    const highRatio = numerator / high;
    const lowRatio = numerator / low;
    
    const midiMeter = Math.abs(meterRatio - highRatio) < Math.abs(meterRatio - lowRatio) 
      ? [numerator, high] 
      : [numerator, low];
    
    const midiMeterRatio = midiMeter[0] / midiMeter[1];
    const syncFactor = midiMeterRatio / meterRatio;
    
    return {
      midiMeter,
      meterRatio,
      midiMeterRatio,
      syncFactor
    };
  }

  getPolyrhythm(numerator, denominator, composer) {
    const meterRatio = numerator / denominator;
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const [polyNumerator, polyDenominator] = composer.getMeter(true, true);
      const polyMeterRatio = polyNumerator / polyDenominator;
      
      const bestMatch = this.findPolyrhythmMatch(meterRatio, polyMeterRatio);
      
      if (this.isValidPolyrhythm(bestMatch, numerator, denominator, polyNumerator, polyDenominator)) {
        return {
          ...bestMatch,
          polyNumerator,
          polyDenominator,
          polyMeterRatio
        };
      }
      
      attempts++;
    }

    // Fallback to simple rhythm if no polyrhythm found
    return {
      measuresPerPhrase1: 1,
      measuresPerPhrase2: 0,
      polyNumerator: numerator,
      polyDenominator: denominator,
      polyMeterRatio: meterRatio
    };
  }

  findPolyrhythmMatch(meterRatio, polyMeterRatio) {
    let bestMatch = {
      originalMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity
    };

    for (let originalMeasures = 1; originalMeasures < 6; originalMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 6; polyMeasures++) {
        const timeDifference = Math.abs(
          originalMeasures * meterRatio - polyMeasures * polyMeterRatio
        );
        
        if (timeDifference < 0.00000001) {
          const currentMatch = {
            originalMeasures,
            polyMeasures,
            totalMeasures: originalMeasures + polyMeasures
          };
          
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }

    return bestMatch;
  }

  isValidPolyrhythm(match, numerator, denominator, polyNumerator, polyDenominator) {
    return match.totalMeasures !== Infinity &&
           match.totalMeasures > 2 &&
           (match.originalMeasures > 1 || match.polyMeasures > 1) &&
           (numerator !== polyNumerator || denominator !== polyDenominator);
  }

  setMeasureTiming(state) {
    const tpPhrase = state.get('tpPhrase');
    const measuresPerPhrase = state.get('measuresPerPhrase');
    const tpSec = state.get('tpSec');
    const phraseStart = state.get('phraseStart') || 0;
    const phraseStartTime = state.get('phraseStartTime') || 0;
    const measureIndex = state.get('measureIndex') || 0;

    if (tpPhrase == null || tpPhrase <= 0) {
      throw new Error('Invalid or missing tpPhrase timing value');
    }
    if (measuresPerPhrase == null || measuresPerPhrase <= 0) {
      throw new Error('Invalid or missing measuresPerPhrase timing value');
    }
    if (tpSec == null || tpSec <= 0) {
      throw new Error('Invalid or missing tpSec timing value');
    }

    const tpMeasure = tpPhrase / measuresPerPhrase;
    const spMeasure = tpMeasure / tpSec;
    const measureStart = phraseStart + measureIndex * tpMeasure;
    const measureStartTime = phraseStartTime + measureIndex * spMeasure;

    return {
      tpMeasure,
      spMeasure,
      measureStart,
      measureStartTime
    };
  }

  setBeatTiming(state) {
    const numerator = state.get('numerator');
    const tpMeasure = state.get('tpMeasure');
    const tpSec = state.get('tpSec');
    const bpm = state.get('bpm') || this.config.bpm || 72;
    const phraseStart = state.get('phraseStart') || 0;
    const measureIndex = state.get('measureIndex') || 0;
    const measureStartTime = state.get('measureStartTime') || 0;
    const beatIndex = state.get('beatIndex') || 0;
    const denominator = state.get('denominator') || 4;

    if (numerator == null || numerator <= 0) {
      throw new Error('Invalid or missing numerator for beat timing');
    }
    if (tpMeasure == null || tpMeasure <= 0) {
      throw new Error('Invalid or missing tpMeasure for beat timing');
    }
    if (tpSec == null || tpSec <= 0) {
      throw new Error('Invalid or missing tpSec for beat timing');
    }

    const tpBeat = tpMeasure / numerator;
    const spBeat = tpBeat / tpSec;
    const trueBPM = 60 / spBeat;
    const bpmRatio = bpm / trueBPM;
    const bpmRatio2 = trueBPM / bpm;
    const trueBPM2 = numerator * (numerator / denominator) / 4;
    const bpmRatio3 = 1 / trueBPM2;

    const beatStart = phraseStart + measureIndex * tpMeasure + beatIndex * tpBeat;
    const beatStartTime = measureStartTime + beatIndex * spBeat;

    return {
      tpBeat,
      spBeat,
      trueBPM,
      bpmRatio,
      bpmRatio2,
      trueBPM2,
      bpmRatio3,
      beatStart,
      beatStartTime
    };
  }

  setDivTiming(state) {
    const divsPerBeat = state.get('divsPerBeat');
    const tpBeat = state.get('tpBeat');
    const tpSec = state.get('tpSec');
    const beatStart = state.get('beatStart') || 0;
    const beatStartTime = state.get('beatStartTime') || 0;
    const divIndex = state.get('divIndex') || 0;

    if (tpBeat == null || tpBeat <= 0) {
      throw new Error('Invalid or missing tpBeat for division timing');
    }
    if (divsPerBeat == null) {
      throw new Error('Invalid or missing divsPerBeat for division timing');
    }
    if (tpSec == null || tpSec <= 0) {
      throw new Error('Invalid or missing tpSec for division timing');
    }

    const tpDiv = tpBeat / Math.max(1, divsPerBeat);
    const spDiv = tpDiv / tpSec;
    const divStart = beatStart + divIndex * tpDiv;
    const divStartTime = beatStartTime + divIndex * spDiv;

    return {
      tpDiv,
      spDiv,
      divStart,
      divStartTime
    };
  }

  setSubdivTiming(state) {
    const subdivsPerDiv = state.get('subdivsPerDiv');
    const tpDiv = state.get('tpDiv');
    const tpSec = state.get('tpSec');
    const numerator = state.get('numerator');
    const meterRatio = state.get('meterRatio');
    const divStart = state.get('divStart') || 0;
    const divStartTime = state.get('divStartTime') || 0;
    const subdivIndex = state.get('subdivIndex') || 0;
    const divsPerBeat = state.get('divsPerBeat') || 1;

    if (tpDiv == null || tpDiv <= 0) {
      throw new Error('Invalid or missing tpDiv for subdivision timing');
    }
    if (subdivsPerDiv == null) {
      throw new Error('Invalid or missing subdivsPerDiv for subdivision timing');
    }
    if (tpSec == null || tpSec <= 0) {
      throw new Error('Invalid or missing tpSec for subdivision timing');
    }
    if (numerator == null) {
      throw new Error('Invalid or missing numerator for subdivision timing');
    }
    if (meterRatio == null) {
      throw new Error('Invalid or missing meterRatio for subdivision timing');
    }

    const tpSubdiv = tpDiv / Math.max(1, subdivsPerDiv);
    const spSubdiv = tpSubdiv / tpSec;
    const subdivsPerMinute = 60 / spSubdiv;
    const subdivStart = divStart + subdivIndex * tpSubdiv;
    const subdivStartTime = divStartTime + subdivIndex * spSubdiv;
    const subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;

    return {
      tpSubdiv,
      spSubdiv,
      subdivsPerMinute,
      subdivStart,
      subdivStartTime,
      subdivFreq
    };
  }

  setSubsubdivTiming(state) {
    const subsubdivsPerSub = state.get('subsubdivsPerSub');
    const tpSubdiv = state.get('tpSubdiv');
    const tpSec = state.get('tpSec');
    const subdivStart = state.get('subdivStart') || 0;
    const subdivStartTime = state.get('subdivStartTime') || 0;
    const subsubdivIndex = state.get('subsubdivIndex') || 0;

    if (tpSubdiv == null || tpSubdiv <= 0) {
      throw new Error('Invalid or missing tpSubdiv for subsubdivision timing');
    }
    if (subsubdivsPerSub == null) {
      throw new Error('Invalid or missing subsubdivsPerSub for subsubdivision timing');
    }
    if (tpSec == null || tpSec <= 0) {
      throw new Error('Invalid or missing tpSec for subsubdivision timing');
    }

    const tpSubsubdiv = tpSubdiv / Math.max(1, subsubdivsPerSub);
    const spSubsubdiv = tpSubsubdiv / tpSec;
    const subsubdivsPerMinute = 60 / spSubsubdiv;
    const subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;
    const subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;

    return {
      tpSubsubdiv,
      spSubsubdiv,
      subsubdivsPerMinute,
      subsubdivStart,
      subsubdivStartTime
    };
  }

  nextSection(state, csvWriter) {
    const allChannels = state.get('allChannels') || [];
    const sectionStart = state.get('sectionStart') || 0;

    // All notes off at section boundary
    allChannels.forEach(ch => {
      csvWriter.addControlChange(Math.max(0, sectionStart - 1), ch, 123, 0);
    });

    const tpSection = state.get('tpSection') || 0;
    const spSection = state.get('spSection') || 0;
    const silentOutroSeconds = this.config.silentOutroSeconds || 5;

    return {
      sectionStart: sectionStart + tpSection,
      sectionStartTime: state.get('sectionStartTime') + spSection,
      finalTime: this.formatTime(state.get('sectionStartTime') + spSection + silentOutroSeconds),
      tpSection: 0,
      spSection: 0
    };
  }

  nextPhrase(state) {
    const tpPhrase = state.get('tpPhrase') || 0;
    const spPhrase = state.get('spPhrase') || 0;

    return {
      phraseStart: state.get('phraseStart') + tpPhrase,
      phraseStartTime: state.get('phraseStartTime') + spPhrase,
      tpSection: state.get('tpSection') + tpPhrase,
      spSection: state.get('spSection') + spPhrase
    };
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(4).padStart(7, '0');
    return `${minutes}:${secs}`;
  }

  isPowerOf2(n) {
    return (n & (n - 1)) === 0;
  }
}