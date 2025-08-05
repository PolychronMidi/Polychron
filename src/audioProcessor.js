// Audio Processor - Handles all audio processing, effects, and channel management
import { RandomGenerator } from './randomGenerator.js';

export class AudioProcessor {
  constructor(config = {}) {
    this.config = {
      tuningFreq: 432,
      binaural: { min: 8, max: 12 },
      ppq: 30000,
      bpm: 72,
      ...config
    };
    
    this._random = new RandomGenerator();
    this.setupChannels();
    this.setupTuning();
    this.setupEffects();
    
    this.flipBin = false;
    this.beatsUntilBinauralShift = 0;
    this.binauralFreqOffset = this._random.float(this.config.binaural.min, this.config.binaural.max);
    this.lastUsedChannels = new Set();
    this.lastUsedChannels2 = new Set();
    this.lastUsedChannels3 = new Set();
  }

  setupChannels() {
    this.channels = {
      cCH1: 0, cCH2: 1, lCH1: 2, rCH1: 3, lCH3: 4, rCH3: 5,
      lCH2: 6, rCH2: 7, lCH4: 8, drumCH: 9, rCH4: 10, cCH3: 11,
      lCH5: 12, rCH5: 13, lCH6: 14, rCH6: 15
    };

    this.bass = [this.channels.cCH3, this.channels.lCH5, this.channels.rCH5, 
                 this.channels.lCH6, this.channels.rCH6];
    this.bassBinaural = [this.channels.lCH5, this.channels.rCH5, 
                        this.channels.lCH6, this.channels.rCH6];
    this.source = [this.channels.cCH1, this.channels.lCH1, this.channels.lCH2, 
                   this.channels.rCH1, this.channels.rCH2];
    this.source2 = [...this.source, this.channels.drumCH];
    this.reflection = [this.channels.cCH2, this.channels.lCH3, this.channels.lCH4, 
                      this.channels.rCH3, this.channels.rCH4];
    this.reflectionBinaural = [this.channels.lCH3, this.channels.lCH4, 
                              this.channels.rCH3, this.channels.rCH4];

    this.binauralL = [this.channels.lCH1, this.channels.lCH2, this.channels.lCH3, 
                     this.channels.lCH4, this.channels.lCH5, this.channels.lCH6];
    this.binauralR = [this.channels.rCH1, this.channels.rCH2, this.channels.rCH3, 
                     this.channels.rCH4, this.channels.rCH5, this.channels.rCH6];

    this.flipBinF = [this.channels.cCH1, this.channels.cCH2, this.channels.cCH3, 
                    this.channels.lCH1, this.channels.rCH1, this.channels.lCH3, 
                    this.channels.rCH3, this.channels.lCH5, this.channels.rCH5];
    this.flipBinT = [this.channels.cCH1, this.channels.cCH2, this.channels.cCH3, 
                    this.channels.lCH2, this.channels.rCH2, this.channels.lCH4, 
                    this.channels.rCH4, this.channels.lCH6, this.channels.rCH6];

    this.allChannels = Object.values(this.channels);
  }

  setupTuning() {
    this.neutralPitchBend = 8192;
    this.semitone = this.neutralPitchBend / 2;
    
    const centsToTuningFreq = 1200 * Math.log2(this.config.tuningFreq / 440);
    this.tuningPitchBend = Math.round(this.neutralPitchBend + (this.semitone * (centsToTuningFreq / 100)));
    
    this.binauralOffset = (plusOrMinus) => {
      const offset = this.semitone * (12 * Math.log2(
        (this.config.tuningFreq + plusOrMinus * this.binauralFreqOffset) / this.config.tuningFreq
      ));
      
      if (isNaN(offset) || !isFinite(offset)) {
        return this.tuningPitchBend;
      }
      
      const result = Math.round(this.tuningPitchBend + offset);
      return Math.max(0, Math.min(16383, result));
    };
    
    this.binauralPlus = this.binauralOffset(1);
    this.binauralMinus = this.binauralOffset(-1);
  }

  setupEffects() {
    this.effects = [1, 5, 11, 65, 67, 68, 69, 70, 71, 72, 73, 74, 91, 92, 93, 94, 95];
    
    this.reflect = {
      [this.channels.cCH1]: this.channels.cCH2,
      [this.channels.lCH1]: this.channels.lCH3,
      [this.channels.rCH1]: this.channels.rCH3,
      [this.channels.lCH2]: this.channels.lCH4,
      [this.channels.rCH2]: this.channels.rCH4
    };
    
    this.reflect2 = {
      [this.channels.cCH1]: this.channels.cCH3,
      [this.channels.lCH1]: this.channels.lCH5,
      [this.channels.rCH1]: this.channels.rCH5,
      [this.channels.lCH2]: this.channels.lCH6,
      [this.channels.rCH2]: this.channels.rCH6
    };
  }

  setTuningAndInstruments(csvWriter) {
    const instruments = this.config.instruments || {};
    
    ['control_c', 'program_c'].forEach(type => {
      this.source.forEach(ch => {
        const isLeft = ch.toString().includes('lCH');
        if (type === 'control_c') {
          csvWriter.addControlChange(0, ch, 10, isLeft ? 0 : 127);
        } else {
          csvWriter.addProgramChange(0, ch, this.getInstrumentNumber(instruments.primary || 'glockenspiel'));
        }
      });
      
      if (type === 'control_c') {
        const safePitchBend = isNaN(this.tuningPitchBend) ? 8192 : this.tuningPitchBend;
        csvWriter.addPitchBend(0, this.channels.cCH1, safePitchBend);
        csvWriter.addPitchBend(0, this.channels.cCH2, safePitchBend);
      } else {
        csvWriter.addProgramChange(0, this.channels.cCH1, this.getInstrumentNumber(instruments.primary || 'glockenspiel'));
        csvWriter.addProgramChange(0, this.channels.cCH2, this.getInstrumentNumber(instruments.secondary || 'music box'));
      }
    });

    ['control_c', 'program_c'].forEach(type => {
      this.bass.forEach(ch => {
        const isLeft = ch.toString().includes('lCH');
        if (type === 'control_c') {
          csvWriter.addControlChange(0, ch, 10, isLeft ? 0 : 127);
        } else {
          csvWriter.addProgramChange(0, ch, this.getInstrumentNumber(
            isLeft ? instruments.bass || 'Acoustic Bass' : instruments.bass2 || 'Synth Bass 2'
          ));
        }
      });
      
      if (type === 'control_c') {
        const safePitchBend = isNaN(this.tuningPitchBend) ? 8192 : this.tuningPitchBend;
        csvWriter.addPitchBend(0, this.channels.cCH3, safePitchBend);
      } else {
        csvWriter.addProgramChange(0, this.channels.cCH3, this.getInstrumentNumber(instruments.bass || 'Acoustic Bass'));
      }
    });

    csvWriter.addControlChange(0, this.channels.drumCH, 7, 127);
  }

  setOtherInstruments(state, csvWriter) {
    const beatCount = state.get('beatCount') || 0;
    const beatsUntilBinauralShift = state.get('beatsUntilBinauralShift') || 0;
    const firstLoop = state.get('firstLoop') || 0;
    const beatStart = state.get('beatStart') || 0;
    
    if (this._random.float() < 0.3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop < 1) {
      const instruments = this.config.instruments || {};
      
      this.reflectionBinaural.forEach(ch => {
        csvWriter.addProgramChange(beatStart, ch, this._random.choice(instruments.others || [79, 89, 97]));
      });
      
      this.bassBinaural.forEach(ch => {
        csvWriter.addProgramChange(beatStart, ch, this._random.choice(instruments.bassOthers || [32, 33, 34]));
      });
      
      csvWriter.addProgramChange(beatStart, this.channels.drumCH, this._random.choice(instruments.drumSets || [0, 8, 16]));
    }
  }

  setBinaural(state, csvWriter) {
    const beatCount = state.get('beatCount') || 0;
    const beatsUntilBinauralShift = state.get('beatsUntilBinauralShift') || 0;
    const firstLoop = state.get('firstLoop') || 0;
    const beatStart = state.get('beatStart') || 0;
    const numerator = state.get('numerator') || 4;
    const bpmRatio3 = state.get('bpmRatio3') || 1;
    
    if (beatCount === beatsUntilBinauralShift || firstLoop < 1) {
      this.allChannels.forEach(ch => {
        csvWriter.addControlChange(beatStart, ch, 123, 0);
      });
      
      this.flipBin = !this.flipBin;
      const newBeatsUntilShift = this._random.int(numerator, Math.max(numerator + 1, numerator * 2 * Math.abs(bpmRatio3)));
      
      const newOffset = this._random.limitedChange(
        this.binauralFreqOffset, -1, 1, 
        this.config.binaural.min, this.config.binaural.max
      );
      
      if (!isNaN(newOffset) && isFinite(newOffset)) {
        this.binauralFreqOffset = newOffset;
      }
      
      this.binauralPlus = this.binauralOffset(1);
      this.binauralMinus = this.binauralOffset(-1);
      
      this.binauralL.forEach(ch => {
        const isSpecialCH = [this.channels.lCH1, this.channels.lCH3, this.channels.lCH5].includes(ch);
        let pitchBend = this.flipBin ? 
          (isSpecialCH ? this.binauralMinus : this.binauralPlus) :
          (isSpecialCH ? this.binauralPlus : this.binauralMinus);
          
        if (isNaN(pitchBend) || !isFinite(pitchBend)) {
          pitchBend = 8192;
        }
        pitchBend = Math.max(0, Math.min(16383, Math.round(pitchBend)));
        
        csvWriter.addPitchBend(beatStart, ch, pitchBend);
      });
      
      this.binauralR.forEach(ch => {
        const isSpecialCH = [this.channels.rCH1, this.channels.rCH3, this.channels.rCH5].includes(ch);
        let pitchBend = this.flipBin ? 
          (isSpecialCH ? this.binauralPlus : this.binauralMinus) :
          (isSpecialCH ? this.binauralMinus : this.binauralPlus);
          
        if (isNaN(pitchBend) || !isFinite(pitchBend)) {
          pitchBend = 8192;
        }
        pitchBend = Math.max(0, Math.min(16383, Math.round(pitchBend)));
        
        csvWriter.addPitchBend(beatStart, ch, pitchBend);
      });
      
      this.applyVolumeTransitions(state, csvWriter);
      
      return { beatsUntilBinauralShift: newBeatsUntilShift, beatCount: 0, firstLoop: 1 };
    }
    
    return {};
  }

  setBalanceAndFX(state, csvWriter) {
    const beatCount = state.get('beatCount') || 0;
    const beatsUntilBinauralShift = state.get('beatsUntilBinauralShift') || 0;
    const firstLoop = state.get('firstLoop') || 0;
    const beatStart = state.get('beatStart') || 0;
    const bpmRatio3 = state.get('bpmRatio3') || 1;
    
    if (this._random.float() < 0.5 * Math.abs(bpmRatio3) || beatCount % beatsUntilBinauralShift < 1 || firstLoop < 1) {
      const balOffset = this._random.limitedChange(0, -4, 4, 0, 45);
      const sideBias = this._random.limitedChange(0, -2, 2, -20, 20);
      
      const lBal = Math.max(0, Math.min(54, balOffset + this._random.int(3) + sideBias));
      const rBal = Math.min(127, Math.max(74, 127 - balOffset - this._random.int(3) + sideBias));
      const cBal = Math.min(96, Math.max(32, 64 + Math.round(this._random.variation(balOffset / Math.max(1, this._random.int(2, 3)))) * 
        (this._random.float() < 0.5 ? -1 : 1) + sideBias));
      
      this.applyChannelBalance(csvWriter, beatStart, lBal, rBal, cBal);
      this.applyChannelEffects(csvWriter, beatStart);
      
      return { firstLoop: 1 };
    }
    
    return {};
  }

  applyVolumeTransitions(state, csvWriter) {
    const beatStart = state.get('beatStart') || 0;
    const tpSec = state.get('tpSec') || this.config.ppq * this.config.bpm / 60;
    
    if (isNaN(tpSec) || tpSec <= 0) {
      return;
    }
    
    const startTick = beatStart - tpSec / 4;
    const endTick = beatStart + tpSec / 4;
    const steps = 10;
    const tickIncrement = (endTick - startTick) / steps;
    
    const flipBinF2 = this.flipBinF.filter(ch => ch !== this.channels.cCH1);
    const flipBinT2 = this.flipBinT.filter(ch => ch !== this.channels.cCH1);
    
    for (let i = Math.floor(steps / 2) - 1; i <= steps; i++) {
      const tick = startTick + (tickIncrement * i);
      const currentVolumeF2 = this.flipBin ? 
        Math.floor(100 * (1 - (i / steps))) : 
        Math.floor(100 * (i / steps));
      const currentVolumeT2 = this.flipBin ? 
        Math.floor(100 * (i / steps)) : 
        Math.floor(100 * (1 - (i / steps)));
      const maxVol = this._random.float(0.9, 1.2);
      
      flipBinF2.forEach(ch => {
        const volume = Math.max(0, Math.min(127, Math.round(currentVolumeF2 * maxVol)));
        csvWriter.addControlChange(tick, ch, 7, volume);
      });
      
      flipBinT2.forEach(ch => {
        const volume = Math.max(0, Math.min(127, Math.round(currentVolumeT2 * maxVol)));
        csvWriter.addControlChange(tick, ch, 7, volume);
      });
    }
  }

  applyChannelBalance(csvWriter, tick, lBal, rBal, cBal) {
    this.source2.forEach(ch => {
      let balance;
      if (ch.toString().includes('lCH')) {
        balance = this.flipBin ? lBal : rBal;
      } else if (ch.toString().includes('rCH')) {
        balance = this.flipBin ? rBal : lBal;
      } else if (ch === this.channels.drumCH) {
        balance = cBal + Math.round((this._random.float(-0.5, 0.5)) * this._random.int(1, 10));
      } else {
        balance = cBal;
      }
      
      balance = Math.max(0, Math.min(127, Math.round(balance)));
      csvWriter.addControlChange(tick, ch, 10, balance);
    });
  }

  applyChannelEffects(csvWriter, tick) {
    const effectConfigs = [
      { controller: 1, min: 0, max: 60, special: ch => ch === this.channels.cCH1, specialMin: 0, specialMax: 10 },
      { controller: 5, min: 125, max: 127, special: ch => ch === this.channels.cCH1, specialMin: 126, specialMax: 127 },
      { controller: 11, min: 64, max: 127, special: ch => ch === this.channels.cCH1 || ch === this.channels.drumCH, specialMin: 115, specialMax: 127 },
    ];
    
    this.source2.forEach(ch => {
      effectConfigs.forEach(config => {
        const isSpecial = config.special && config.special(ch);
        const min = isSpecial ? config.specialMin : config.min;
        const max = isSpecial ? config.specialMax : config.max;
        const value = Math.max(0, Math.min(127, this._random.int(min, max)));
        
        csvWriter.addControlChange(tick, ch, config.controller, value);
      });
    });
  }

  applyEffects(state, csvWriter) {
    const channels = this.flipBin ? this.flipBinT : this.flipBinF;
    
    this.stutterFade(channels.slice(1), state, csvWriter);
    this.stutterFX(channels.slice(1), state, csvWriter);
    
    if (this._random.float() < 0.05) {
      this.stutterPan(channels.slice(1), state, csvWriter);
    } else {
      this.stutterPan([this.channels.cCH1, this.channels.cCH2, this.channels.cCH3, this.channels.drumCH], state, csvWriter);
    }
  }

  stutterFade(channels, state, csvWriter) {
    const beatStart = state.get('beatStart') || 0;
    const tpSec = state.get('tpSec') || this.config.ppq * this.config.bpm / 60;
    
    if (isNaN(tpSec) || tpSec <= 0 || channels.length === 0) {
      return;
    }
    
    const numStutters = this._random.int(10, 70);
    const duration = tpSec * this._random.float(0.2, 1.5);
    const channelsToStutter = Math.min(this._random.int(1, 5), channels.length);
    
    const availableChannels = channels.filter(ch => !this.lastUsedChannels.has(ch));
    const channelsToSelect = availableChannels.length > 0 ? availableChannels : channels;
    const selectedChannels = channelsToSelect.length > 0 ? 
      this._random.sample(channelsToSelect, Math.min(channelsToStutter, channelsToSelect.length)) : [];
    
    selectedChannels.forEach(ch => {
      const maxVol = this._random.int(90, 120);
      const isFadeIn = this._random.boolean();
      
      for (let i = Math.floor(numStutters * this._random.float(1/3, 2/3)); i < numStutters; i++) {
        const tick = beatStart + i * (duration / numStutters) * this._random.float(0.9, 1.1);
        let volume;
        
        if (isFadeIn) {
          volume = Math.max(25, Math.min(maxVol, Math.floor(maxVol * (i / (numStutters - 1)))));
        } else {
          volume = Math.max(25, Math.min(100, Math.floor(100 * (1 - (i / (numStutters - 1))))));
        }
        
        const finalVolume = Math.max(0, Math.min(127, Math.round(volume / this._random.float(1.5, 5))));
        csvWriter.addControlChange(tick, ch, 7, finalVolume);
        csvWriter.addControlChange(tick + duration * this._random.float(0.95, 1.95), ch, 7, Math.max(0, Math.min(127, volume)));
      }
    });
    
    this.lastUsedChannels = new Set(selectedChannels);
  }

  stutterPan(channels, state, csvWriter) {
    const beatStart = state.get('beatStart') || 0;
    const tpSec = state.get('tpSec') || this.config.ppq * this.config.bpm / 60;
    
    if (isNaN(tpSec) || tpSec <= 0 || channels.length === 0) {
      return;
    }
    
    const numStutters = this._random.int(30, 90);
    const duration = tpSec * this._random.float(0.1, 1.2);
    const channelsToStutter = Math.min(this._random.int(1, 2), channels.length);
    
    const availableChannels = channels.filter(ch => !this.lastUsedChannels2.has(ch));
    const channelsToSelect = availableChannels.length > 0 ? availableChannels : channels;
    const selectedChannels = channelsToSelect.length > 0 ? 
      this._random.sample(channelsToSelect, Math.min(channelsToStutter, channelsToSelect.length)) : [];
    
    selectedChannels.forEach(ch => {
      const edgeMargin = this._random.int(7, 25);
      const maxPan = 127 - edgeMargin;
      const isFadeIn = this._random.boolean();
      
      for (let i = Math.floor(numStutters * this._random.float(1/3)); i < numStutters; i++) {
        const tick = beatStart + i * (duration / numStutters) * this._random.float(0.7, 1.3);
        let pan;
        
        if (isFadeIn) {
          pan = Math.max(edgeMargin, Math.min(maxPan, Math.floor(maxPan * (i / (numStutters - 1)))));
        } else {
          pan = Math.max(edgeMargin, Math.min(maxPan, Math.floor(maxPan * (1 - (i / (numStutters - 1))))));
        }
        
        const finalPan = Math.max(0, Math.min(127, pan + this._random.int(32, 96)));
        csvWriter.addControlChange(tick, ch, 10, finalPan);
        csvWriter.addControlChange(tick + duration * this._random.float(0.5, 1.75), ch, 10, Math.max(0, Math.min(127, pan)));
      }
    });
    
    this.lastUsedChannels2 = new Set(selectedChannels);
  }

  stutterFX(channels, state, csvWriter) {
    const beatStart = state.get('beatStart') || 0;
    const tpSec = state.get('tpSec') || this.config.ppq * this.config.bpm / 60;
    
    if (isNaN(tpSec) || tpSec <= 0 || channels.length === 0) {
      return;
    }
    
    const numStutters = this._random.int(30, 100);
    const duration = tpSec * this._random.float(0.1, 2);
    const channelsToStutter = Math.min(this._random.int(1, 2), channels.length);
    
    const availableChannels = channels.filter(ch => !this.lastUsedChannels3.has(ch));
    const channelsToSelect = availableChannels.length > 0 ? availableChannels : channels;
    const selectedChannels = channelsToSelect.length > 0 ? 
      this._random.sample(channelsToSelect, Math.min(channelsToStutter, channelsToSelect.length)) : [];
    
    selectedChannels.forEach(ch => {
      const fxController = this._random.choice(this.effects);
      const edgeMargin = this._random.int(7, 25);
      const max = 127 - edgeMargin;
      const isFadeIn = this._random.boolean();
      
      for (let i = Math.floor(numStutters * this._random.float(1/3)); i < numStutters; i++) {
        const tick = beatStart + i * (duration / numStutters) * this._random.float(0.7, 1.3);
        let value;
        
        if (isFadeIn) {
          value = Math.max(edgeMargin, Math.min(max, Math.floor(max * (i / (numStutters - 1)))));
        } else {
          value = Math.max(edgeMargin, Math.min(max, Math.floor(max * (1 - (i / (numStutters - 1))))));
        }
        
        const finalValue = Math.max(0, Math.min(127, value + this._random.int(32, 96)));
        csvWriter.addControlChange(tick, ch, fxController, finalValue);
        csvWriter.addControlChange(tick + duration * this._random.float(0.75, 1.5), ch, fxController, Math.max(0, Math.min(127, value)));
      }
    });
    
    this.lastUsedChannels3 = new Set(selectedChannels);
  }

  playNotes(notes, state, csvWriter) {
    const subdivStart = state.get('subdivStart') || 0;
    const tpSubdiv = state.get('tpSubdiv') || 1;
    const tpBeat = state.get('tpBeat') || 1;
    const tpDiv = state.get('tpDiv') || 1;
    const subdivsPerDiv = state.get('subdivsPerDiv') || 1;
    const subdivsPerMinute = state.get('subdivsPerMinute') || 60;
    const velocity = state.get('velocity') || 99;
    
    if (isNaN(subdivStart) || isNaN(tpSubdiv) || isNaN(tpBeat) || isNaN(tpDiv)) {
      return;
    }
    
    const crossModulation = this.calculateCrossModulation(state);
    
    if (crossModulation > this._random.float(1.8, 2.8)) {
      notes.forEach(({ note }) => {
        if (isNaN(note) || note < 0 || note > 127) {
          return;
        }
        
        const sourceChannels = this.source.filter(sourceCH => {
          return this.flipBin ? this.flipBinT.includes(sourceCH) : this.flipBinF.includes(sourceCH);
        });
        
        sourceChannels.forEach(sourceCH => {
          const on = subdivStart + (tpSubdiv * this._random.variation(this._random.float(0.2), [-0.1, 0.07], 0.3));
          const shortSustain = this._random.variation(
            this._random.float(Math.max(tpDiv * 0.5, tpDiv / subdivsPerDiv), tpBeat * (0.3 + this._random.float() * 0.7)),
            [0.1, 0.2], 0.1, [-0.05, -0.1]
          );
          const longSustain = this._random.variation(
            this._random.float(tpDiv * 0.8, tpBeat * (0.3 + this._random.float() * 0.7)),
            [0.1, 0.3], 0.1, [-0.05, -0.1]
          );
          const useShort = subdivsPerMinute > this._random.int(400, 650);
          const sustain = Math.max(1, (useShort ? shortSustain : longSustain) * this._random.variation(this._random.float(0.8, 1.3)));
          
          const noteVelocity = sourceCH === this.channels.cCH1 ? 
            velocity * this._random.float(0.95, 1.15) : 
            velocity * this._random.float(0.42, 0.57) * this._random.float(0.95, 1.03);
          
          const finalVelocity = Math.max(1, Math.min(127, Math.round(noteVelocity)));
          
          csvWriter.addNoteOn(Math.round(on), sourceCH, Math.round(note), finalVelocity);
          csvWriter.addNoteOff(Math.round(on + sustain), sourceCH, Math.round(note));
          
          if (this._random.float() < this._random.variation(0.2, [0.5, 1], 0.3)) {
            this.applyNoteStutter(csvWriter, sourceCH, note, on, sustain, velocity);
          }
        });
      });
    }
  }

  playNotes2(notes, state, csvWriter) {
    this.playNotes(notes, state, csvWriter);
  }

  applyNoteStutter(csvWriter, channel, note, startTime, sustain, baseVelocity) {
    const numStutters = Math.round(this._random.variation(this._random.variation(this._random.int(3, 9), [2, 5], 0.33), [2, 5], 0.1));
    const duration = 0.25 * this._random.int(1, 6) * sustain / Math.max(1, numStutters);
    const isFadeIn = this._random.boolean();
    const decay = this._random.float(0.75, 1.25);
    
    for (let i = 0; i < numStutters; i++) {
      const tick = startTime + duration * i;
      let stutterNote = note;
      
      if (this._random.float() < 0.25) {
        const octaveShift = this._random.int(-3, 3) * 12;
        stutterNote = Math.max(0, Math.min(127, note + octaveShift));
      }
      
      let currentVelocity;
      const denominator = Math.max(1, numStutters * this._random.float(0.4, 2.2) - 1);
      
      if (isFadeIn) {
        const fadeInMultiplier = decay * (i / denominator);
        currentVelocity = Math.max(0, Math.min(100, Math.min(111, this._random.int(33) + 111 * fadeInMultiplier)));
      } else {
        const fadeOutMultiplier = 1 - (decay * (i / denominator));
        currentVelocity = Math.max(0, Math.min(100, Math.max(0, this._random.int(33) + 111 * fadeOutMultiplier)));
      }
      
      const finalVelocity = channel === this.channels.cCH1 ? 
        Math.max(1, Math.min(127, Math.round(currentVelocity * this._random.float(0.3, 0.7)))) : 
        Math.max(1, Math.min(127, Math.round(currentVelocity * this._random.float(0.45, 0.8))));
      
      csvWriter.addNoteOff(Math.round(tick - duration * this._random.float(0.15)), channel, Math.round(stutterNote));
      csvWriter.addNoteOn(Math.round(tick + duration * this._random.float(0.15, 0.6)), channel, Math.round(stutterNote), finalVelocity);
    }
    
    csvWriter.addNoteOff(Math.round(startTime + sustain * this._random.float(0.5, 1.5)), channel, Math.round(note));
  }

  calculateCrossModulation(state) {
    const beatRhythm = state.get('beatRhythm') || [];
    const divRhythm = state.get('divRhythm') || [];
    const subdivRhythm = state.get('subdivRhythm') || [];
    const beatIndex = state.get('beatIndex') || 0;
    const divIndex = state.get('divIndex') || 0;
    const subdivIndex = state.get('subdivIndex') || 0;
    const numerator = state.get('numerator') || 4;
    const divsPerBeat = state.get('divsPerBeat') || 1;
    const subdivsPerDiv = state.get('subdivsPerDiv') || 1;
    const subdivsPerMinute = state.get('subdivsPerMinute') || 60;
    const beatsOn = state.get('beatsOn') || 0;
    const beatsOff = state.get('beatsOff') || 0;
    const divsOn = state.get('divsOn') || 0;
    const divsOff = state.get('divsOff') || 0;
    const subdivsOn = state.get('subdivsOn') || 0;
    const subdivsOff = state.get('subdivsOff') || 0;
    
    let crossModulation = 0;
    
    crossModulation += beatRhythm[beatIndex] > 0 ? this._random.float(1.5, 3) : 
      Math.max(this._random.float(0.625, 1.25), (1 / numerator) * beatsOff + (1 / numerator) * beatsOn);
    
    crossModulation += divRhythm[divIndex] > 0 ? this._random.float(1, 2) : 
      Math.max(this._random.float(0.5, 1), (1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn);
    
    crossModulation += subdivRhythm[subdivIndex] > 0 ? this._random.float(0.5, 1) : 
      Math.max(this._random.float(0.25, 0.5), (1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn);
    
    crossModulation += subdivsOn < this._random.int(7, 15) ? this._random.float(0.1, 0.3) : this._random.float(-0.1);
    crossModulation += subdivsPerMinute > this._random.int(400, 600) ? this._random.float(-0.4, -0.6) : this._random.float(0.1);
    crossModulation += beatRhythm[beatIndex] < 1 ? this._random.float(0.4, 0.5) : 0;
    
    if (isNaN(crossModulation) || !isFinite(crossModulation)) {
      return 2.0;
    }
    
    return crossModulation;
  }

  getInstrumentNumber(instrumentName) {
    const instruments = {
      'glockenspiel': 9,
      'music box': 10,
      'Acoustic Bass': 32,
      'Synth Bass 2': 39
    };
    
    return instruments[instrumentName] || 0;
  }
}