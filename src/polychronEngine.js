import { ComposerFactory } from './composerFactory.js';
import { TimeManager } from './timeManager.js';
import { AudioProcessor } from './audioProcessor.js';
import { CSVWriter } from './csvWriter.js';
import { RhythmEngine } from './rhythmEngine.js';
import { CompositionState } from './compositionState.js';
import { Logger } from './logger.js';

export class PolychronEngine {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config.logging);
    this.state = new CompositionState({
      sectionStart: 0,
      sectionStartTime: 0,
      phraseStart: 0,
      phraseStartTime: 0,
      tpSection: 0,
      spSection: 0,
      measureCount: 0,
      beatCount: 0,
      velocity: 99,
      flipBin: false,
      crossModulation: 2.2,
      beatsUntilBinauralShift: 0,
      firstLoop: 0,
      allChannels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      bpm: config.midi?.bpm || 72,
      ...config.initialState
    });
    this.timeManager = new TimeManager(config.timing);
    this.audioProcessor = new AudioProcessor(config.audio);
    this.rhythmEngine = new RhythmEngine(config.rhythm);
    this.csvWriter = new CSVWriter(config.midi);
    this.composers = config.composers.map(composerConfig =>
      ComposerFactory.create(composerConfig.type, composerConfig)
    );
    this.currentComposerIndex = 0;
  }

  async generateComposition() {
    try {
      this.audioProcessor.setTuningAndInstruments(this.csvWriter);
      const totalSections = this.config.structure.sections.random();

      for (let sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
        await this.generateSection(sectionIndex, totalSections);
      }

      this.finalizeComposition();
      return this.csvWriter.export();
    } catch (error) {
      throw error;
    }
  }

  async generateSection(sectionIndex, totalSections) {
    const composer = this.getNextComposer();
    const phrasesPerSection = this.config.structure.phrasesPerSection.random();

    this.state = this.state.update({
      sectionIndex,
      totalSections,
      composer,
      phrasesPerSection
    });

    const sectionStart = sectionIndex * 180000;
    this.csvWriter.addMarker(sectionStart, `Section ${sectionIndex + 1}`);

    this.logger.logUnit('section', this.state, this.csvWriter);

    for (let phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
      await this.generatePhrase(phraseIndex, composer, sectionIndex);
    }

    const sectionUpdates = this.timeManager.nextSection(this.state, this.csvWriter);
    this.state = this.state.update(sectionUpdates);
  }

  async generatePhrase(phraseIndex, composer, sectionIndex) {
    const [numerator, denominator] = composer.getMeter();
    const baseBPM = this.config.midi?.bpm || 72;
    const bpmVariation = (Math.random() - 0.5) * 40;
    const newBPM = baseBPM + bpmVariation;
    const clampedBPM = Math.max(50, Math.min(150, Math.round(newBPM)));
    const phraseStart = (sectionIndex * 180000) + (phraseIndex * 90000);
    
    this.csvWriter.addTempo(phraseStart, clampedBPM);
    this.csvWriter.addTimeSignature(phraseStart, numerator, denominator);
    this.csvWriter.addMarker(phraseStart, `Phrase ${phraseIndex + 1} - ${numerator}/${denominator} at ${clampedBPM} BPM`);

    const midiMeterObj = this.timeManager.getMidiMeter(numerator, denominator);
    const midiMeter = midiMeterObj.midiMeter;
    const meterRatio = midiMeterObj.meterRatio;
    const polyrhythm = this.timeManager.getPolyrhythm(numerator, denominator, composer);
    const measuresPerPhrase = polyrhythm.measuresPerPhrase1 || 1;
    const ppq = this.config.midi?.ppq || 30000;
    const tpPhrase = measuresPerPhrase * numerator * ppq;
    const tpSec = ppq * clampedBPM / 60;
    const spPhrase = tpPhrase / tpSec;

    this.state = this.state.update({
      phraseIndex,
      numerator,
      denominator,
      midiMeter,
      meterRatio,
      polyrhythm,
      measuresPerPhrase,
      tpPhrase,
      tpSec,
      spPhrase,
      bpm: clampedBPM,
      phraseStart: phraseStart
    });

    this.logger.logUnit('phrase', this.state, this.csvWriter);
    await this.generateMeasures(measuresPerPhrase, numerator, composer);

    if (polyrhythm.measuresPerPhrase2 > 0) {
      const polyBPM = Math.max(60, Math.min(120, clampedBPM * 1.2));
      const polyStart = phraseStart + 45000;
      
      this.csvWriter.addTempo(polyStart, Math.round(polyBPM));
      this.csvWriter.addTimeSignature(polyStart, polyrhythm.polyNumerator, polyrhythm.polyDenominator);
      this.csvWriter.addMarker(polyStart, `Polyrhythm - ${polyrhythm.polyNumerator}/${polyrhythm.polyDenominator} at ${Math.round(polyBPM)} BPM`);
      
      await this.generateMeasures(polyrhythm.measuresPerPhrase2, polyrhythm.polyNumerator, composer);
    }

    const phraseUpdates = this.timeManager.nextPhrase(this.state);
    this.state = this.state.update(phraseUpdates);
  }

  async generateMeasures(measuresPerPhrase, numerator, composer) {
    for (let measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      await this.generateMeasure(measureIndex, numerator, composer);
    }
  }

  async generateMeasure(measureIndex, numerator, composer) {
    this.state = this.state.update({ measureIndex, numerator });
    const timing = this.timeManager.setMeasureTiming(this.state);
    this.state = this.state.update(timing);
    this.logger.logUnit('measure', this.state, this.csvWriter);

    const beatRhythm = this.rhythmEngine.setRhythm('beat', numerator);
    for (let beatIndex = 0; beatIndex < numerator; beatIndex++) {
      await this.generateBeat(beatIndex, beatRhythm, composer);
    }
  }

  async generateBeat(beatIndex, beatRhythm, composer) {
    this.state = this.state.update({ beatIndex });
    const timing = this.timeManager.setBeatTiming(this.state);
    this.state = this.state.update(timing);

    this.rhythmEngine.trackBeatRhythm(beatIndex, beatRhythm, this.state);
    this.logger.logUnit('beat', this.state, this.csvWriter);

    this.audioProcessor.setOtherInstruments(this.state, this.csvWriter);
    const binauralUpdates = this.audioProcessor.setBinaural(this.state, this.csvWriter);
    this.state = this.state.update(binauralUpdates);
    const fxUpdates = this.audioProcessor.setBalanceAndFX(this.state, this.csvWriter);
    this.state = this.state.update(fxUpdates);
    this.rhythmEngine.playDrums(this.state, this.csvWriter);
    this.audioProcessor.applyEffects(this.state, this.csvWriter);

    const divsPerBeat = composer.getDivisions();
    this.state = this.state.update({ divsPerBeat });
    const divRhythm = this.rhythmEngine.setRhythm('div', divsPerBeat);

    for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {
      await this.generateDivision(divIndex, divRhythm, composer);
    }
  }

  async generateDivision(divIndex, divRhythm, composer) {
    this.state = this.state.update({ divIndex });
    const subdivsPerDiv = composer.getSubdivisions();
    this.state = this.state.update({ subdivsPerDiv });
    const timing = this.timeManager.setDivTiming(this.state);
    this.state = this.state.update(timing);

    this.rhythmEngine.trackDivRhythm(divIndex, divRhythm, this.state);
    this.logger.logUnit('division', this.state, this.csvWriter);

    const subdivRhythm = this.rhythmEngine.setRhythm('subdiv', subdivsPerDiv);

    for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
      await this.generateSubdivision(subdivIndex, subdivRhythm, composer);
    }
  }

  async generateSubdivision(subdivIndex, subdivRhythm, composer) {
    this.state = this.state.update({ subdivIndex });
    const subsubdivsPerSub = composer.getSubsubdivs();
    this.state = this.state.update({ subsubdivsPerSub });
    const timing = this.timeManager.setSubdivTiming(this.state);
    this.state = this.state.update(timing);

    this.logger.logUnit('subdivision', this.state, this.csvWriter);

    const notes = composer.getNotes();
    this.audioProcessor.playNotes(notes, this.state, this.csvWriter);

    for (let subsubdivIndex = 0; subsubdivIndex < subsubdivsPerSub; subsubdivIndex++) {
      await this.generateSubsubdivision(subsubdivIndex, composer);
    }
  }

  async generateSubsubdivision(subsubdivIndex, composer) {
    this.state = this.state.update({ subsubdivIndex });
    const timing = this.timeManager.setSubsubdivTiming(this.state);
    this.state = this.state.update(timing);
    this.logger.logUnit('subsubdivision', this.state, this.csvWriter);

    const notes = composer.getNotes();
    this.audioProcessor.playNotes2(notes, this.state, this.csvWriter);
  }

  getNextComposer() {
    const composer = this.composers[this.currentComposerIndex];
    this.currentComposerIndex = (this.currentComposerIndex + 1) % this.composers.length;
    return composer;
  }

  finalizeComposition() {
    this.csvWriter.grandFinale(this.state);
  }
}