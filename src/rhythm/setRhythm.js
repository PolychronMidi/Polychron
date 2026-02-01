const { random: _random } = require('@tonaljs/rhythm-pattern');

setRhythm = function setRhythm(level, ctx = null) {
  const random = (length, probOn) => { return _random(length, 1 - probOn); };
  switch (level) {
    case 'beat': {
      const res = beatRhythm < 1 ? random(numerator) : getRhythm('beat', numerator, beatRhythm);
      if (!Array.isArray(res)) {
        console.error('[setRhythm] CRITICAL: Beat rhythm could not be generated', { level: 'beat', numerator, beatRhythm });
      }
      if (ctx && typeof ctx === 'object') ctx.beatRhythm = res;
      return res;
    }
    case 'div': {
      const res = divRhythm < 1 ? random(divsPerBeat, .4) : getRhythm('div', divsPerBeat, divRhythm);
      if (!Array.isArray(res)) {
        console.error('[setRhythm] CRITICAL: Div rhythm could not be generated', { level: 'div', divsPerBeat, divRhythm });
      }
      if (ctx && typeof ctx === 'object') ctx.divRhythm = res;
      return res;
    }
    case 'subdiv': {
      const res = subdivRhythm < 1 ? random(subdivsPerDiv, .3) : getRhythm('subdiv', subdivsPerDiv, subdivRhythm);
      if (!Array.isArray(res)) {
        console.error('[setRhythm] CRITICAL: Subdiv rhythm could not be generated', { level: 'subdiv', subdivsPerDiv, subdivRhythm });
      }
      if (ctx && typeof ctx === 'object') ctx.subdivRhythm = res;
      return res;
    }
    case 'subsubdiv': {
      const res = subsubdivRhythm < 1 ? random(subsubsPerSub, .3) : getRhythm('subsubdiv', subsubsPerSub, subsubdivRhythm);
      if (!Array.isArray(res)) {
        console.error('[setRhythm] CRITICAL: Subsubdiv rhythm could not be generated', { level: 'subsubdiv', subsubsPerSub, subsubdivRhythm });
      }
      if (ctx && typeof ctx === 'object') ctx.subsubdivRhythm = res;
      return res;
    }
    default: throw new Error('Invalid level provided to setRhythm');
  }
};
