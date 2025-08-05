// Base Measure Composer - Abstract class for all composer types
import { RandomGenerator } from './randomGenerator.js';
import { MathUtils } from './mathUtils.js';

export class MeasureComposer {
  constructor(options = {}) {
    this._random = new RandomGenerator(options.seed);
    this.lastMeter = null;
    this.notes = [];
    this.config = {
      // Default musical parameters - can be overridden by CONFIG
      numerator: { min: 2, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      denominator: { min: 3, max: 11, weights: [10, 20, 30, 40, 20, 10, 5, 1] },
      octave: { min: 0, max: 8, weights: [11, 27, 33, 35, 33, 35, 30, 7, 3] },
      voices: { min: 1, max: 7, weights: [15, 30, 25, 7, 4, 3, 2, 1] },
      divisions: { min: 1, max: 10, weights: [1, 15, 20, 25, 20, 10, 10, 7, 2, 2, 1] },
      subdivisions: { min: 1, max: 10, weights: [5, 10, 20, 15, 20, 10, 20, 4, 2, 1] },
      subsubdivs: { min: 1, max: 5, weights: [5, 20, 30, 20, 10, 5] },
      ...options
    };
  }

  // Abstract methods - must be implemented by subclasses
  getNotes(octaveRange = null) {
    throw new Error('getNotes method must be implemented by subclass');
  }

  // Meter generation methods
  getNumerator() {
    const { min, max, weights } = this.config.numerator;
    const bpmRatio = this.getBpmRatio();
    return Math.floor(this._random.weightedRandom(min, max, weights) * (this._random.float() > 0.5 ? bpmRatio : 1));
  }

  getDenominator() {
    const { min, max, weights } = this.config.denominator;
    const bpmRatio = this.getBpmRatio();
    return Math.floor(this._random.weightedRandom(min, max, weights) * (this._random.float() > 0.5 ? bpmRatio : 1));
  }

  getDivisions() {
    const { min, max, weights } = this.config.divisions;
    const bpmRatio = this.getBpmRatio();
    return Math.max(1, Math.floor(this._random.weightedRandom(min, max, weights) * (this._random.float() > 0.5 ? bpmRatio : 1)));
  }

  getSubdivisions() {
    const { min, max, weights } = this.config.subdivisions;
    const bpmRatio = this.getBpmRatio();
    return Math.max(1, Math.floor(this._random.weightedRandom(min, max, weights) * (this._random.float() > 0.5 ? bpmRatio : 1)));
  }

  getSubsubdivs() {
    const { min, max, weights } = this.config.subsubdivs;
    const bpmRatio = this.getBpmRatio();
    return Math.max(1, Math.floor(this._random.weightedRandom(min, max, weights) * (this._random.float() > 0.5 ? bpmRatio : 1)));
  }

  getVoices() {
    const { min, max, weights } = this.config.voices;
    const bpmRatio = this.getBpmRatio();
    return Math.max(1, Math.floor(this._random.weightedRandom(min, max, weights) * (this._random.float() > 0.5 ? bpmRatio : 1)));
  }

  getOctaveRange() {
    const { min, max, weights } = this.config.octave;
    let [o1, o2] = [
      this._random.weightedRandom(min, max, weights),
      this._random.weightedRandom(min, max, weights)
    ];
    
    while (Math.abs(o1 - o2) < 2) {
      o2 = this._random.weightedRandom(min, max, weights);
    }
    
    return [Math.min(o1, o2), Math.max(o1, o2)];
  }

  getMeter(ignoreRatioCheck = false, forceNew = false) {
    const maxAttempts = 100;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const newNumerator = this.getNumerator();
      const newDenominator = this.getDenominator();
      const newMeterRatio = newNumerator / newDenominator;

      if ((newMeterRatio >= 0.3 && newMeterRatio <= 3)) {
        if (this.lastMeter && !ignoreRatioCheck) {
          const lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
          const ratioChange = Math.abs(newMeterRatio - lastMeterRatio);
          
          if (ratioChange <= 0.75) {
            this.lastMeter = [newNumerator, newDenominator];
            return this.lastMeter;
          }
        } else {
          this.lastMeter = [newNumerator, newDenominator];
          return this.lastMeter;
        }
      }
      
      attempts++;
    }

    // Fallback to simple meter
    return this.lastMeter || [4, 4];
  }

  // Helper methods
  getBpmRatio() {
    // This would be passed in from the engine, for now return 1
    return 1;
  }

  generateNoteFromScale(octaveRange, interval = 0) {
    if (!this.notes || this.notes.length === 0) {
      throw new Error('No notes available for composition');
    }

    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const rootNote = this.notes[this._random.int(0, this.notes.length - 1)];
    const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
    const octave = this._random.int(minOctave, maxOctave);
    
    // Convert to MIDI note number (assuming Tonal.js format)
    const note = this.noteToMidiNumber(this.notes[noteIndex], octave);
    
    return { note, octave, interval };
  }

  noteToMidiNumber(noteName, octave) {
    // This is a simplified conversion - in the real implementation,
    // you'd use Tonal.js: t.Note.chroma(noteName) + 12 * octave
    const noteMap = {
      'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
      'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
      'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
    };
    
    const baseNote = noteMap[noteName] || 0;
    return baseNote + 12 * octave;
  }

  validateNotes() {
    if (!Array.isArray(this.notes) || this.notes.length === 0) {
      throw new Error('Composer must have valid notes array');
    }
    return true;
  }
}