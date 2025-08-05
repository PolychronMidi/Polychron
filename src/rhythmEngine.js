// Rhythm Engine - Handles rhythm generation and drum patterns
import { RandomGenerator } from './randomGenerator.js';

export class RhythmEngine {
  constructor(config = {}) {
    this.config = {
      patterns: {
        'binary': { weights: [2, 3, 1], method: 'binary' },
        'hex': { weights: [2, 3, 1], method: 'hex' },
        'onsets': { weights: [5, 0, 0], method: 'onsets' },
        'onsets2': { weights: [0, 2, 0], method: 'onsets' },
        'onsets3': { weights: [0, 0, 7], method: 'onsets' },
        'random': { weights: [7, 0, 0], method: 'random' },
        'random2': { weights: [0, 3, 0], method: 'random' },
        'random3': { weights: [0, 0, 1], method: 'random' },
        'euclid': { weights: [3, 3, 3], method: 'euclid' },
        'rotate': { weights: [2, 2, 2], method: 'rotate' },
        'morph': { weights: [2, 3, 3], method: 'morph' }
      },
      ...config
    };
    
    this._random = new RandomGenerator();
  }

  setRhythm(type, length) {
    if (!length || length <= 0) {
      return [];
    }
    
    const patterns = Object.keys(this.config.patterns);
    const selectedPattern = this._random.choice(patterns);
    const patternConfig = this.config.patterns[selectedPattern];
    
    switch (patternConfig.method) {
      case 'binary':
        return this.generateBinaryRhythm(length);
      case 'hex':
        return this.generateHexRhythm(length);
      case 'onsets':
        return this.generateOnsetsRhythm(length);
      case 'random':
        return this.generateRandomRhythm(length);
      case 'euclid':
        return this.generateEuclideanRhythm(length);
      case 'rotate':
        return this.generateRotatedRhythm(length);
      case 'morph':
        return this.generateMorphedRhythm(length);
      default:
        return this.generateRandomRhythm(length);
    }
  }

  generateBinaryRhythm(length) {
    const rhythm = [];
    for (let i = 0; i < length; i++) {
      rhythm.push(this._random.boolean(0.6) ? 1 : 0);
    }
    return rhythm;
  }

  generateHexRhythm(length) {
    const hexPatterns = [
      [1, 0, 1, 0, 1, 0],
      [1, 1, 0, 1, 0, 1],
      [1, 0, 0, 1, 1, 0],
      [1, 1, 1, 0, 0, 0],
      [1, 0, 1, 1, 0, 0]
    ];
    
    const pattern = this._random.choice(hexPatterns);
    const rhythm = [];
    
    for (let i = 0; i < length; i++) {
      rhythm.push(pattern[i % pattern.length]);
    }
    
    return rhythm;
  }

  generateOnsetsRhythm(length) {
    const rhythm = new Array(length).fill(0);
    const numOnsets = Math.max(1, Math.floor(length * this._random.float(0.2, 0.7)));
    
    const onsetPositions = [];
    while (onsetPositions.length < numOnsets) {
      const pos = this._random.int(0, length - 1);
      if (!onsetPositions.includes(pos)) {
        onsetPositions.push(pos);
        rhythm[pos] = 1;
      }
    }
    
    return rhythm;
  }

  generateRandomRhythm(length) {
    const rhythm = [];
    const density = this._random.float(0.3, 0.8);
    
    for (let i = 0; i < length; i++) {
      rhythm.push(this._random.boolean(density) ? 1 : 0);
    }
    
    return rhythm;
  }

  generateEuclideanRhythm(length) {
    const hits = Math.max(1, Math.floor(length * this._random.float(0.3, 0.7)));
    return this.euclideanAlgorithm(hits, length);
  }

  euclideanAlgorithm(hits, total) {
    if (hits >= total) {
      return new Array(total).fill(1);
    }
    
    const rhythm = new Array(total).fill(0);
    const spacing = total / hits;
    
    for (let i = 0; i < hits; i++) {
      const position = Math.round(i * spacing) % total;
      rhythm[position] = 1;
    }
    
    return rhythm;
  }

  generateRotatedRhythm(length) {
    const baseRhythm = this.generateBinaryRhythm(length);
    const rotation = this._random.int(0, length - 1);
    
    return [...baseRhythm.slice(rotation), ...baseRhythm.slice(0, rotation)];
  }

  generateMorphedRhythm(length) {
    const rhythm1 = this.generateRandomRhythm(length);
    const rhythm2 = this.generateEuclideanRhythm(length);
    const morphFactor = this._random.float(0, 1);
    
    const rhythm = [];
    for (let i = 0; i < length; i++) {
      const value = rhythm1[i] * (1 - morphFactor) + rhythm2[i] * morphFactor;
      rhythm.push(value > 0.5 ? 1 : 0);
    }
    
    return rhythm;
  }

  trackBeatRhythm(beatIndex, beatRhythm, state) {
    const beatsOn = beatRhythm.filter(beat => beat > 0).length;
    const beatsOff = beatRhythm.length - beatsOn;
    
    return state.update({
      beatRhythm,
      beatsOn,
      beatsOff
    });
  }

  trackDivRhythm(divIndex, divRhythm, state) {
    const divsOn = divRhythm.filter(div => div > 0).length;
    const divsOff = divRhythm.length - divsOn;
    
    return state.update({
      divRhythm,
      divsOn,
      divsOff
    });
  }

  trackSubdivRhythm(subdivIndex, subdivRhythm, state) {
    const subdivsOn = subdivRhythm.filter(subdiv => subdiv > 0).length;
    const subdivsOff = subdivRhythm.length - subdivsOn;
    
    return state.update({
      subdivRhythm,
      subdivsOn,
      subdivsOff
    });
  }

  playDrums(state, csvWriter) {
    const beatIndex = state.get('beatIndex') || 0;
    const beatRhythm = state.get('beatRhythm') || [];
    const beatStart = state.get('beatStart') || 0;
    const velocity = state.get('velocity') || 99;
    const drumChannel = 9; // Standard MIDI drum channel
    
    // Play drums if beat is active
    if (beatRhythm[beatIndex] > 0) {
      // Kick drum on beat 1 and 3
      if (beatIndex % 2 === 0) {
        const kickNote = 36; // Standard kick drum
        const kickVelocity = Math.max(80, Math.min(127, velocity * this._random.float(0.9, 1.1)));
        csvWriter.addNoteOn(beatStart, drumChannel, kickNote, Math.round(kickVelocity));
        csvWriter.addNoteOff(beatStart + 240, drumChannel, kickNote);
      }
      
      // Snare on beat 2 and 4
      if (beatIndex % 2 === 1) {
        const snareNote = 38; // Standard snare drum
        const snareVelocity = Math.max(70, Math.min(127, velocity * this._random.float(0.8, 1.0)));
        csvWriter.addNoteOn(beatStart, drumChannel, snareNote, Math.round(snareVelocity));
        csvWriter.addNoteOff(beatStart + 180, drumChannel, snareNote);
      }
      
      // Hi-hat on every beat with variation
      if (this._random.boolean(0.7)) {
        const hihatNote = this._random.boolean(0.3) ? 42 : 44; // Closed/Open hi-hat
        const hihatVelocity = Math.max(40, Math.min(100, velocity * this._random.float(0.4, 0.7)));
        csvWriter.addNoteOn(beatStart, drumChannel, hihatNote, Math.round(hihatVelocity));
        csvWriter.addNoteOff(beatStart + 120, drumChannel, hihatNote);
      }
      
      // Occasional other percussion
      if (this._random.boolean(0.2)) {
        const percNotes = [39, 41, 43, 45, 47]; // Various percussion
        const percNote = this._random.choice(percNotes);
        const percVelocity = Math.max(50, Math.min(110, velocity * this._random.float(0.6, 0.9)));
        csvWriter.addNoteOn(beatStart, drumChannel, percNote, Math.round(percVelocity));
        csvWriter.addNoteOff(beatStart + 150, drumChannel, percNote);
      }
    }
  }
}