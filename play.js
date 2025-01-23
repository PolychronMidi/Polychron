// Clean minimal code style with focus on direct & clear naming & structure,instead of distracting comments,excessive line breaks & empty lines. Global scope used where possible for cleaner simplicity. https://github.com/PolychronMidi/Polychron
require('./stage');
setTuningAndInstruments();
totalSections=ri(SECTIONS.min,SECTIONS.max);  
for (sectionIndex=0; sectionIndex < totalSections; sectionIndex++) {
  composer=composers[ri(COMPOSERS.length - 1)];
  phrasesPerSection=ri(PHRASES_PER_SECTION.min,PHRASES_PER_SECTION.max);  

  for (phraseIndex=0; phraseIndex < phrasesPerSection; phraseIndex++) {
    [numerator,denominator]=composer.getMeter();
    getMidiMeter(); getPolyrhythm(); logUnit('phrase');

    measuresPerPhrase=measuresPerPhrase1;
    for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) {
      setMeasureTiming(); logUnit('measure'); beatRhythm=setRhythm('beat'); 
      for (beatIndex=0; beatIndex < numerator; beatIndex++) {  trackBeatRhythm();
        setBeatTiming(); logUnit('beat'); divRhythm=setRhythm('div'); 
        setTertiaryInstruments(); setBinaural(); setBalanceAndFX();
        for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
          setDivTiming(); logUnit('division'); subdivRhythm=setRhythm('subdiv');
          for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) { 
            setSubdivTiming(); logUnit('subdivision'); playNotes(); }}}
        }

    beatRhythm=divRhythm=subdivRhythm=0; 
    numerator=polyNumerator;  meterRatio=polyMeterRatio;
    measuresPerPhrase=measuresPerPhrase2;
    for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) {
      setMeasureTiming(); logUnit('measure'); beatRhythm=setRhythm('beat'); 
      for (beatIndex=0; beatIndex < numerator; beatIndex++) {  trackBeatRhythm();
        setBeatTiming(); logUnit('beat'); divRhythm=setRhythm('div'); 
        for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
          setDivTiming(); logUnit('division'); subdivRhythm=setRhythm('subdiv');
          for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) { 
            setSubdivTiming(); logUnit('subdivision'); playNotes(); }}}
        }
    nextPhrase();
  }
  logUnit('section'); nextSection();
}
grandFinale(); 
