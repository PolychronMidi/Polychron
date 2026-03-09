// _random provided by patterns.js (same module) - no duplicate assignment needed

const V = validator.create('setRhythm');

/**
 * Resolve and cache rhythm arrays per level.
 * @param {'beat'|'div'|'subdiv'|'subsubdiv'} level
 * @param {{ beatRhythm?: number[], divRhythm?: number[], subdivRhythm?: number[], subsubdivRhythm?: number[] }|null} [ctx=null]
 * @returns {number[]}
 */
setRhythm = function setRhythm(level, ctx = null) {
  V.assertNonEmptyString(level, 'level');
  const random = (length, probOn) => { return _random(length, 1 - probOn); };
  // -- Texture-modulated onset density (#8) --
  // Flurry activity - denser onsets (more notes), burst activity - sparser (give chords room)
  const texProbScale = (() => {
    const metrics = drumTextureCoupler.getMetrics();
    if (metrics.intensity > 0.15) {
      const burstDom = metrics.burstCount > metrics.flurryCount;
      return burstDom ? (1 - metrics.intensity * 0.4) : (1 + metrics.intensity * 0.5);
    }
    return 1;
  })();
  switch (level) {
    case 'beat': {
      const res = beatRhythm < 1 ? random(numerator) : getRhythm('beat', numerator, beatRhythm);
      V.assertArray(res, 'res');
      if (ctx !== null) ctx.beatRhythm = res;
      return res;
    }
    case 'div': {
      const res = divRhythm < 1 ? random(divsPerBeat, clamp(.4 * texProbScale, 0.1, 0.9)) : getRhythm('div', divsPerBeat, divRhythm);
      V.assertArray(res, 'res');
      if (ctx !== null) ctx.divRhythm = res;
      return res;
    }
    case 'subdiv': {
      const res = subdivRhythm < 1 ? random(subdivsPerDiv, clamp(.3 * texProbScale, 0.1, 0.9)) : getRhythm('subdiv', subdivsPerDiv, subdivRhythm);
      V.assertArray(res, 'res');
      if (ctx !== null) ctx.subdivRhythm = res;
      return res;
    }
    case 'subsubdiv': {
      const res = subsubdivRhythm < 1 ? random(subsubsPerSub, clamp(.3 * texProbScale, 0.1, 0.9)) : getRhythm('subsubdiv', subsubsPerSub, subsubdivRhythm);
      V.assertArray(res, 'res');
      if (ctx !== null) ctx.subsubdivRhythm = res;
      return res;
    }
    default: throw new Error('Invalid level provided to setRhythm');
  }
};
