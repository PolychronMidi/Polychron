// Dependency: drummer is required via `src/rhythm/index.js`

playDrums = function playDrums() {
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
};
