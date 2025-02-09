// Clean minimal code style with focus on direct & clear naming & structure, instead of distracting comments, excessive line breaks & empty lines. Global scope used where possible for cleaner simplicity. https://github.com/PolychronMidi/Polychron
require('./stage');
setTuningAndInstruments();
totalSections=ri(SECTIONS.min,SECTIONS.max);  
for (sectionIndex=0; sectionIndex < totalSections; sectionIndex++) {
  composer=ra(composers);
  phrasesPerSection=ri(PHRASES_PER_SECTION.min,PHRASES_PER_SECTION.max);  

  for (phraseIndex=0; phraseIndex < phrasesPerSection; phraseIndex++) {
    [numerator,denominator]=composer.getMeter();
    getMidiMeter(); getPolyrhythm(); logUnit('phrase');

    measuresPerPhrase=measuresPerPhrase1;
    for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) { measureCount++;
      setMeasureTiming(); logUnit('measure'); beatRhythm=setRhythm('beat'); 
      for (beatIndex=0; beatIndex < numerator; beatIndex++) {trackBeatRhythm();beatCount++;
        setBeatTiming(); logUnit('beat'); divRhythm=setRhythm('div'); 
        setOtherInstruments(); setBinaural(); setBalanceAndFX(); playDrums();
        stutterFX(flipBin ? flipBinT3 : flipBinF3);
        stutterFade(flipBin ? flipBinT3 : flipBinF3);
        rf()<.05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
        for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
          setDivTiming(); logUnit('division'); subdivRhythm=setRhythm('subdiv');
          for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) { 
            setSubdivTiming(); logUnit('subdivision'); playNotes(); }
            for (subsubdivIndex=0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) { 
              setSubsubdivTiming(); logUnit('subsubdivision'); playNotes2(); }
    }}}

    beatRhythm=divRhythm=subdivRhythm=0; 
    numerator=polyNumerator;  meterRatio=polyMeterRatio;
    measuresPerPhrase=measuresPerPhrase2;
    for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) {
      setMeasureTiming(); logUnit('measure'); beatRhythm=setRhythm('beat'); 
      for (beatIndex=0; beatIndex < numerator; beatIndex++) {  trackBeatRhythm();
        setBeatTiming(); logUnit('beat'); divRhythm=setRhythm('div'); playDrums2();
        for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
          setDivTiming(); logUnit('division'); subdivRhythm=setRhythm('subdiv');
          for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) { 
            setSubdivTiming(); logUnit('subdivision'); playNotes(); }
            for (subsubdivIndex=0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) { 
              setSubsubdivTiming(); logUnit('subsubdivision'); playNotes2(); }
    }}}

    nextPhrase();
  }
  logUnit('section'); nextSection();
}
grandFinale(); 
