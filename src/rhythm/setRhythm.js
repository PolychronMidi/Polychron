_random = require('@tonaljs/rhythm-pattern').random;

setRhythm = function setRhythm(level, ctx = null) {
  const random = (length, probOn) => { return _random(length, 1 - probOn); };
  // ── Texture-modulated onset density (#8) ──────────────────────────
  // Flurry activity → denser onsets (more notes), burst activity → sparser (give chords room)
  const texProbScale = (() => {
    if (typeof DrumTextureCoupler !== 'undefined' && DrumTextureCoupler && typeof DrumTextureCoupler.getMetrics === 'function') {
      const metrics = DrumTextureCoupler.getMetrics();
      if (metrics.intensity > 0.15) {
        const burstDom = metrics.burstCount > metrics.flurryCount;
        return burstDom ? (1 - metrics.intensity * 0.4) : (1 + metrics.intensity * 0.5);
      }
    }
    return 1;
  })();
  switch (level) {
    case 'beat': {
      const res = beatRhythm < 1 ? random(numerator) : getRhythm('beat', numerator, beatRhythm);
      if (!Array.isArray(res)) {
        throw new Error(`[setRhythm] Beat rhythm could not be generated (level=beat, numerator=${numerator}, beatRhythm=${beatRhythm})`);
      }
      if (ctx && typeof ctx === 'object') ctx.beatRhythm = res;
      return res;
    }
    case 'div': {
      const res = divRhythm < 1 ? random(divsPerBeat, clamp(.4 * texProbScale, 0.1, 0.9)) : getRhythm('div', divsPerBeat, divRhythm);
      if (!Array.isArray(res)) {
        throw new Error(`[setRhythm] Div rhythm could not be generated (level=div, divsPerBeat=${divsPerBeat}, divRhythm=${divRhythm})`);
      }
      if (ctx && typeof ctx === 'object') ctx.divRhythm = res;
      return res;
    }
    case 'subdiv': {
      const res = subdivRhythm < 1 ? random(subdivsPerDiv, clamp(.3 * texProbScale, 0.1, 0.9)) : getRhythm('subdiv', subdivsPerDiv, subdivRhythm);
      if (!Array.isArray(res)) {
        throw new Error(`[setRhythm] Subdiv rhythm could not be generated (level=subdiv, subdivsPerDiv=${subdivsPerDiv}, subdivRhythm=${subdivRhythm})`);
      }
      if (ctx && typeof ctx === 'object') ctx.subdivRhythm = res;
      return res;
    }
    case 'subsubdiv': {
      const res = subsubdivRhythm < 1 ? random(subsubsPerSub, clamp(.3 * texProbScale, 0.1, 0.9)) : getRhythm('subsubdiv', subsubsPerSub, subsubdivRhythm);
      if (!Array.isArray(res)) {
        throw new Error(`[setRhythm] Subsubdiv rhythm could not be generated (level=subsubdiv, subsubsPerSub=${subsubsPerSub}, subsubdivRhythm=${subsubdivRhythm})`);
      }
      if (ctx && typeof ctx === 'object') ctx.subsubdivRhythm = res;
      return res;
    }
    default: throw new Error('Invalid level provided to setRhythm');
  }
};
