const { drummer } = require('./drummer');

module.exports.playDrums2 = function playDrums2(){
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
};
