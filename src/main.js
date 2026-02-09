// main.js - Main composition engine orchestrating section, phrase, measure hierarchy.
require('./index');

main = async function main() { console.log('Starting main.js ...');

const { layer: L1, buffer: c1 } = LM.register('L1', 'c1', {}, () => setTuningAndInstruments());
const { layer: L2, buffer: c2 } = LM.register('L2', 'c2', {}, () => setTuningAndInstruments());

// Create composer context for explicit dependency passing (fail-fast: throw if managers missing)
const composerCtx = {
  phraseArc: ComposerFactory.getPhraseArcManager(),
  layerMgr: typeof LM !== 'undefined' ? LM : (() => { throw new Error('main: LayerManager (LM) not available'); })(),
  rhythmMgr: typeof RhythmRegistry !== 'undefined' ? RhythmRegistry : (() => { throw new Error('main: RhythmRegistry not available'); })(),
  stutterMgr: typeof StutterManager !== 'undefined' ? new StutterManager() : null,
  eventBus: typeof EventBus !== 'undefined' ? EventBus : (() => { throw new Error('main: EventBus not available'); })(),
  harmonicCtx: typeof HarmonicContext !== 'undefined' ? HarmonicContext : (() => { throw new Error('main: HarmonicContext not available'); })(),
  motifChain: typeof MotifChain !== 'undefined' ? MotifChain : null
};
ComposerFactory.setComposerContext(composerCtx);

// Initialize EventBus feedback loop: FX intensity → rhythm pattern modulation
if (typeof FXFeedbackListener !== 'undefined') {
  FXFeedbackListener.initialize();
}

totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) {
  phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);

  // Emit section boundary event to reset FX feedback accumulator
  EventBus.emit('section-boundary', { sectionIndex });

  // Initialize each layer's section origin so layer-relative ticks are correct and explicit
  LM.setSectionStartAll();

  // Explicitly log a `section` marker for both layers so Section 1 is present
  // for both `L1` and `L2` outputs. Restore `L1` as active for
  // the phrase loop immediately after logging.
  LM.activate('L1', false);
  setUnitTiming('section');
  // Activate L2 without setting `isPoly` yet (L2 meter isn't known until later)
  LM.activate('L2', false);
  setUnitTiming('section');
  LM.activate('L1', false);

  for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
    composer = ComposerFactory.createRandom({ root: 'random' }, composerCtx);
    [numerator, denominator] = composer.getMeter();
    // Activate L1 layer first so activation doesn't overwrite freshly computed timing
    LM.activate('L1', false);
    getMidiTiming();
    getPolyrhythm();
    measuresPerPhrase = measuresPerPhrase1;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      measureCount++;
      setUnitTiming('measure');

      // Get phrase context for dynamism scaling
      const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager)
        ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
        : { dynamism: 0.7, atStart: false, atEnd: false };

      // Scale play/stutter probabilities by dynamism
      const dynScale = DYNAMISM.scaleBase + phraseCtx.dynamism * DYNAMISM.scaleRange;
      const basePlayProb = phraseCtx.atStart ? DYNAMISM.playProb.start : DYNAMISM.playProb.mid;
      const baseStutterProb = phraseCtx.atEnd ? DYNAMISM.stutterProb.end : DYNAMISM.stutterProb.mid;
      const playProb = basePlayProb * dynScale;
      const stutterProb = baseStutterProb * dynScale;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        beatCount++;
        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        EventBus.emit('beat-binaural-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex });
        setBalanceAndFX();
        // Capture FX intensity from balance and variation globals (normalized 0-1)
        const fxStereoPan = typeof balOffset === 'number' ? Math.abs(balOffset) / 45 : 0;
        const fxVelocityShift = (typeof refVar === 'number' && typeof bassVar === 'number')
          ? Math.abs(refVar + bassVar) / 20 : 0;
        EventBus.emit('beat-fx-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex, stereoPan: fxStereoPan, velocityShift: fxVelocityShift });
        playDrums();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        playNotes('beat', { playProb, stutterProb });
        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {
          setUnitTiming('div');
          playNotes('div', { playProb, stutterProb });
          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            playNotes('subdiv', { playProb, stutterProb });
            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotes('subsubdiv', { playProb, stutterProb }); }
            }
          }
        }
      }
    }

    // Clean layer state at phrase boundary to prevent state bleeding
    playMotifs.resetLayerState(L1);
    LM.advance('L1', 'phrase');

    LM.activate('L2', true);

    getMidiTiming();
    measuresPerPhrase = measuresPerPhrase2;
    setUnitTiming('phrase');
    for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
      setUnitTiming('measure');

      // Get phrase context for L2 dynamism scaling
      const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager)
        ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
        : { dynamism: 0.7, atStart: false, atEnd: false };

      const dynScale = DYNAMISM.scaleBase + phraseCtx.dynamism * DYNAMISM.scaleRange;
      const basePlayProb = phraseCtx.atStart ? DYNAMISM.playProb.start : DYNAMISM.playProb.mid;
      const baseStutterProb = phraseCtx.atEnd ? DYNAMISM.stutterProb.end : DYNAMISM.stutterProb.mid;
      const playProb = basePlayProb * dynScale;
      const stutterProb = baseStutterProb * dynScale;

      for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
        setUnitTiming('beat');
        setOtherInstruments();
        setBinaural();
        EventBus.emit('beat-binaural-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex, layer: 'L2' });
        setBalanceAndFX();
        EventBus.emit('beat-fx-applied', { beatIndex, sectionIndex, phraseIndex, measureIndex, layer: 'L2' });
        playDrums2();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf() < .05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        playNotes('beat', { playProb, stutterProb });

        for (let divIndex = 0; divIndex < divsPerBeat; divIndex++) {

          setUnitTiming('div');
          playNotes('div', { playProb, stutterProb });

          for (let subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
            setUnitTiming('subdiv');
            playNotes('subdiv', { playProb, stutterProb });

            for (let subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
              setUnitTiming('subsubdiv');
              if (subsubdivIndex > 0) { playNotes('subsubdiv', { playProb, stutterProb }); }
            }
          }
        }
      }
    }

    // Clean layer state at phrase boundary to prevent state bleeding
    playMotifs.resetLayerState(L2);
    LM.advance('L2', 'phrase');
  }

  LM.advance('L1', 'section');

  LM.advance('L2', 'section');

}

  grandFinale();
}

// Run main only when invoked as the entry script
if (require.main === module) {
  main().catch((err) => {
    console.error('main.js failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
