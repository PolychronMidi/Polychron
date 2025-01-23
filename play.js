// Clean minimal code style with focus on direct & clear naming & structure,instead of distracting comments,excessive line breaks & empty lines. Global scope used where possible for cleaner simplicity. https://github.com/PolychronMidi/Polychron
require('./stage');

setTuningAndInstruments();
totalSections=ri(SECTIONS.min,SECTIONS.max);  

for (sectionIndex=0; sectionIndex < totalSections; sectionIndex++) {
  composer=composers[ri(COMPOSERS.length - 1)];
  phrasesPerSection=ri(PHRASES_PER_SECTION.min,PHRASES_PER_SECTION.max);  

  for (phraseIndex=0; phraseIndex < phrasesPerSection; phraseIndex++) {
    [numerator,denominator]=composer.getMeter();
    getMidiMeter(); getPolyrhythm();
    logUnit('phrase');

    measuresPerPhrase=measuresPerPhrase1;
    for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) {
      incrementMeasure(); logUnit('measure');
      beatRhythm=setRhythm('beat'); 
      for (beatIndex=0; beatIndex < numerator; beatIndex++) {  trackBeatRhythm();
        beatStart=phraseStart + measureIndex * ticksPerMeasure + beatIndex * ticksPerBeat; logUnit('beat');
        setTertiaryInstruments(); setBinaural(); setBalanceAndFX();
        divsPerBeat=m.ceil(composer.getDivisions() * (meterRatio < 1 ? rf(.7,1.1) : rf(rf(.7,1.05),meterRatio) * (numerator / meterRatio))/ri(3,12));
        divRhythm=setRhythm('div'); ticksPerDiv=ticksPerBeat / m.max(1,divsPerBeat);
        for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
          divStart=beatStart + divIndex * ticksPerDiv; logUnit('division');
          subdivsPerDiv=m.ceil(composer.getSubdivisions() * (meterRatio < 1 ? rf(.95,1.1) : rf(rf(.95,1.05),meterRatio) / (numerator / meterRatio))/ri(3,10));
          subdivFreq=subdivsPerDiv * divsPerBeat * numerator * meterRatio;
          subdivRhythm=setRhythm('subdiv'); ticksPerSubdiv=ticksPerDiv / m.max(1,subdivsPerDiv);
          for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) { 
            subdivStart=divStart + subdivIndex * ticksPerSubdiv; logUnit('subdivision');
            playNotes(); }}}
        }
    beatRhythm=divRhythm=subdivRhythm=0; 
    numerator=polyNumerator;  meterRatio=polyMeterRatio;
    measuresPerPhrase=measuresPerPhrase2;
    ticksPerMeasure=ticksPerPhrase / measuresPerPhrase;
    ticksPerBeat=ticksPerMeasure / numerator;

    for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) {
      incrementMeasure(); logUnit('measure');
      beatRhythm=setRhythm('beat');
       for (beatIndex=0; beatIndex < numerator; beatIndex++) {  trackBeatRhythm();
         beatStart=phraseStart + measureIndex * ticksPerMeasure + beatIndex * ticksPerBeat; logUnit('beat');
         divsPerBeat=m.ceil(composer.getDivisions() * (meterRatio < 1 ? rf(.7,1.1) : rf(rf(.7,1.05),meterRatio) * (numerator / meterRatio))/ri(3,12));
         divRhythm=setRhythm('div'); ticksPerDiv=ticksPerBeat / m.max(1,divsPerBeat);
         for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
           divStart=beatStart + divIndex * ticksPerDiv; logUnit('division');
           subdivsPerDiv=m.ceil(composer.getSubdivisions() * (meterRatio < 1 ? rf(.95,1.1) : rf(rf(.95,1.05),meterRatio) / (numerator / meterRatio))/ri(3,10));
           subdivFreq=subdivsPerDiv * divsPerBeat * numerator * meterRatio;
           subdivRhythm=setRhythm('subdiv'); ticksPerSubdiv=ticksPerDiv / m.max(1,subdivsPerDiv);
           for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) { 
             subdivStart=divStart + subdivIndex * ticksPerSubdiv; logUnit('subdivision');
             playNotes(); }}}
         }
    incrementPhrase();
  }
  logUnit('section');
  incrementSection();
}
grandFinale(); 
