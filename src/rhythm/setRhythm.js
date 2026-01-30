const { random: _random } = require('@tonaljs/rhythm-pattern');
const { raiseCritical } = require('../debug/postfixGuard');

module.exports.setRhythm = function setRhythm(level) {
  const random = (length, probOn) => { return _random(length, 1 - probOn); };
  switch (level) {
    case 'beat': {
      const res = beatRhythm < 1 ? random(numerator) : (require('./getRhythm').getRhythm('beat', numerator, beatRhythm));
      if (!Array.isArray(res)) {
        try { raiseCritical('missing:rhythm', 'Beat rhythm could not be generated', { level: 'beat', numerator, beatRhythm }); } catch (e) { throw new Error('CRITICAL: Beat rhythm missing'); }
      }
      return (beatRhythm = res);
    }
    case 'div': {
      const res = divRhythm < 1 ? random(divsPerBeat, .4) : (require('./getRhythm').getRhythm('div', divsPerBeat, divRhythm));
      if (!Array.isArray(res)) {
        try { raiseCritical('missing:rhythm', 'Division rhythm could not be generated', { level: 'div', divsPerBeat, divRhythm }); } catch (e) { throw new Error('CRITICAL: Division rhythm missing'); }
      }
      return (divRhythm = res);
    }
    case 'subdiv': {
      const res = subdivRhythm < 1 ? random(subdivsPerDiv, .3) : (require('./getRhythm').getRhythm('subdiv', subdivsPerDiv, subdivRhythm));
      if (!Array.isArray(res)) {
        try { raiseCritical('missing:rhythm', 'Subdiv rhythm could not be generated', { level: 'subdiv', subdivsPerDiv, subdivRhythm }); } catch (e) { throw new Error('CRITICAL: Subdiv rhythm missing'); }
      }
      return (subdivRhythm = res);
    }
    case 'subsubdiv': {
      const res = subsubdivRhythm < 1 ? random(subsubsPerSub, .3) : (require('./getRhythm').getRhythm('subsubdiv', subsubsPerSub, subsubdivRhythm));
      if (!Array.isArray(res)) {
        try { raiseCritical('missing:rhythm', 'Subsubdiv rhythm could not be generated', { level: 'subsubdiv', subsubsPerSub, subsubdivRhythm }); } catch (e) { throw new Error('CRITICAL: Subsubdiv rhythm missing'); }
      }
      return (subsubdivRhythm = res);
    }
    default: throw new Error('Invalid level provided to setRhythm');
  }
};
