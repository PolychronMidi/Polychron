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
    for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) { measureCount++;
      setMeasureTiming(); logUnit('measure'); beatRhythm=setRhythm('beat'); 
      for (beatIndex=0; beatIndex < numerator; beatIndex++) {  trackBeatRhythm();beatCount++;
        setBeatTiming(); logUnit('beat'); divRhythm=setRhythm('div'); 
        stutterFade(stutterFadeCHs);
        if (beatIndex % 2===0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
          drummer(['kick1','kick3'],[0,.5]);
          if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
            drummer(['kick2','kick5'],[0,.5]);
          }
        } else if (beatRhythm[beatIndex] > 0  && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
          drummer(['snare1','kick4','kick7','snare4'],[0,.5,.75,.25]);
        } else if (beatIndex % 2===0) {
          drummer('random');
          if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
            drummer(['snare5'],[0]);
          }
        } else  {
          drummer(['snare6'],[0]);
        }
        setOtherInstruments(); setBinaural(); setBalanceAndFX();
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
        stutterFade(stutterFadeCHs);
        if (beatIndex % 2===0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
          drummer(['kick2','kick5','kick7'],[0,.5,.25]);
          if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
            drummer(['kick1','kick3','kick7'],[0,.5,.25]);
          }
        } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
          drummer(['snare2','kick6','snare3'],[0,.5,.75]);
        } else if (beatIndex % 2===0) {
          drummer(['snare7'],[0]);
          if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
            drummer(['snare7'],[0]);
          }
        } else  {
          drummer('random');
        }
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
