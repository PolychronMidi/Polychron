/**
 * Sets pan positions, balance offsets, and detailed FX parameters for all channels
 * @returns {void}
 */
setBalanceAndFX = () => {
const V = validator.create('setBalanceAndFX');
const spatialCanvas = ConductorConfig.getSpatialCanvasParams();
if (!spatialCanvas || typeof spatialCanvas !== 'object' || !Array.isArray(spatialCanvas.balOffset) || !Array.isArray(spatialCanvas.sideBias)) {
  throw new Error('setBalanceAndFX: getSpatialCanvasParams returned invalid shape');
}

const ccGroupScale = spatialCanvas.ccGroupScale;
const ccRangeScale = spatialCanvas.ccRangeScale;
if (!ccGroupScale || typeof ccGroupScale !== 'object' || !ccRangeScale || typeof ccRangeScale !== 'object') {
  throw new Error('setBalanceAndFX: spatialCanvas missing ccGroupScale or ccRangeScale');
}

const journeyFxModulation = ConductorConfig.getJourneyFxModulation();

const scaleFxDefaultObject = (fxDefault, scale) => {
  const minValue = Number(fxDefault.min);
  const maxValue = Number(fxDefault.max);
  const scaled = { ...fxDefault };
  if (Number.isFinite(minValue)) {
    scaled.min = clamp(m.round(minValue * scale), 0, MIDI_MAX_VALUE);
  }
  if (Number.isFinite(maxValue)) {
    scaled.max = clamp(m.round(maxValue * scale), 0, MIDI_MAX_VALUE);
  }
  if (Number.isFinite(Number(scaled.min)) && Number.isFinite(Number(scaled.max)) && scaled.min > scaled.max) {
    const swap = scaled.min;
    scaled.min = scaled.max;
    scaled.max = swap;
  }
  if (Number.isFinite(Number(fxDefault.conditionMin))) {
    scaled.conditionMin = clamp(m.round(Number(fxDefault.conditionMin) * scale), 0, MIDI_MAX_VALUE);
  }
  if (Number.isFinite(Number(fxDefault.conditionMax))) {
    scaled.conditionMax = clamp(m.round(Number(fxDefault.conditionMax) * scale), 0, MIDI_MAX_VALUE);
  }
  if (Number.isFinite(Number(scaled.conditionMin)) && Number.isFinite(Number(scaled.conditionMax)) && scaled.conditionMin > scaled.conditionMax) {
    const swap = scaled.conditionMin;
    scaled.conditionMin = scaled.conditionMax;
    scaled.conditionMax = swap;
  }
  return scaled;
};

const resolveRangeScale = (groupName, effectNum) => {
  const groupBase = Number(ccGroupScale[groupName]);
  const groupMul = V.optionalFinite(groupBase, 1);
  const groupMap = ccRangeScale[groupName];
  if (!groupMap || typeof groupMap !== 'object') {
    throw new Error(`setBalanceAndFX.resolveRangeScale: missing ccRangeScale group "${groupName}"`);
  }
  const specific = Number(groupMap[String(effectNum)]);
  const fallback = Number(groupMap.default);
  const ccMul = V.optionalFinite(specific, V.optionalFinite(fallback, 1));
  return clamp(groupMul * ccMul, 0.1, 4);
};

const scaleFxRange = (minValue, maxValue, rangeScale) => {
  const lo = Number(minValue);
  const hi = Number(maxValue);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return [minValue, maxValue];
  }
  const floor = m.min(lo, hi);
  const ceiling = m.max(lo, hi);
  const center = (floor + ceiling) * 0.5;
  const halfSpan = (ceiling - floor) * 0.5 * rangeScale;
  const scaledMin = clamp(m.round(center - halfSpan), 0, MIDI_MAX_VALUE);
  const scaledMax = clamp(m.round(center + halfSpan), 0, MIDI_MAX_VALUE);
  return scaledMin <= scaledMax ? [scaledMin, scaledMax] : [scaledMax, scaledMin];
};
const requireFiniteScale = (value, name) => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`setBalanceAndFX: invalid ${name} scale (${value})`);
  }
  return n;
};
const resolveFxDefaults = (groupName, effectNum) => {
  if (!FX_CC_DEFAULTS) {
    throw new Error('setBalanceAndFX.resolveFxDefaults: FX_CC_DEFAULTS is not defined');
  }
  const byGroup = FX_CC_DEFAULTS[groupName];
  let resolved;
  if (byGroup && typeof byGroup === 'object' && byGroup[effectNum]) {
    resolved = byGroup[effectNum];
  } else if (FX_CC_DEFAULTS[effectNum]) {
    resolved = FX_CC_DEFAULTS[effectNum];
  } else {
    throw new Error(`setBalanceAndFX.resolveFxDefaults: no FX defaults for group="${groupName}" cc=${effectNum}`);
  }

  if (effectNum === 65) {
    return scaleFxDefaultObject(resolved, requireFiniteScale(journeyFxModulation.portamentoScale, 'portamento'));
  }
  if (effectNum === 74) {
    return scaleFxDefaultObject(resolved, requireFiniteScale(journeyFxModulation.filterScale, 'filter'));
  }
  if (effectNum === 91 || effectNum === 92 || effectNum === 93 || effectNum === 95) {
    return scaleFxDefaultObject(resolved, requireFiniteScale(journeyFxModulation.reverbScale, 'reverb'));
  }
  return resolved;
};

/**
 * @param {string} groupName
 * @param {any} ch
 * @param {number} effectNum
 * @param {(c: any) => boolean} [condition]
 * @param {{min?: number,max?: number,conditionMin?: number,conditionMax?: number}} [overrides]
 */
const rfx = (groupName, ch, effectNum, condition = undefined, overrides = undefined) => {
  const defaults = resolveFxDefaults(groupName, effectNum);
  // Normalize overrides so property access is safe for TS/CheckJS
  const o = (overrides && typeof overrides === 'object') ? overrides : {};
  const minValue = V.optionalFinite(Number(o.min), Number(defaults.min));
  const maxValue = V.optionalFinite(Number(o.max), Number(defaults.max));
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    throw new Error(`setBalanceAndFX.rfx: invalid min/max for group="${groupName}" cc=${effectNum}`);
  }

  const rawConditionMin = V.optionalFinite(Number(o.conditionMin), Number(defaults.conditionMin));
  const rawConditionMax = V.optionalFinite(Number(o.conditionMax), Number(defaults.conditionMax));

  const scale = resolveRangeScale(groupName, effectNum);
  const [scaledMin, scaledMax] = scaleFxRange(minValue, maxValue, scale);
  let scaledConditionMin;
  let scaledConditionMax;
  if (Number.isFinite(rawConditionMin) && Number.isFinite(rawConditionMax)) {
    [scaledConditionMin, scaledConditionMax] = scaleFxRange(rawConditionMin, rawConditionMax, scale);
  }
  return rlFX(ch, effectNum, scaledMin, scaledMax, condition, scaledConditionMin, scaledConditionMax);
};
// Respect both instance state and legacy naked global `firstLoop` set by tests
const _cLenBeforeFX = c.length;
if (rf() < .5*bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop < 1) { firstLoop = 1; firstLoop = 1;
  // Apply a limited change to balance offset: use rl() but cap per-iteration change to +/-4 ticks for stability
  const prevBal = balOffset;
  const balMin = Number(spatialCanvas.balOffset[0]);
  const balMax = Number(spatialCanvas.balOffset[1]);
  const balStep = V.optionalFinite(Number(spatialCanvas.balStep), 4);
  const sideBiasMin = Number(spatialCanvas.sideBias[0]);
  const sideBiasMax = Number(spatialCanvas.sideBias[1]);
  const sideBiasStep = V.optionalFinite(Number(spatialCanvas.sideBiasStep), 2);
  const lBalMax = V.optionalFinite(Number(spatialCanvas.lBalMax), 54);

  const candidateBal = rl(prevBal, -balStep, balStep, balMin, balMax);
  balOffset = clamp(candidateBal, m.max(balMin, prevBal - balStep), m.min(balMax, prevBal + balStep));
  sideBias=rl(sideBias,-sideBiasStep,sideBiasStep,sideBiasMin,sideBiasMax);
  lBal=m.max(0,m.min(lBalMax,balOffset + ri(3) + sideBias));
  rBal=m.min(MIDI_MAX_VALUE,m.max(74,MIDI_MAX_VALUE - balOffset - ri(3) + sideBias));
  cBal=m.min(96,(m.max(32,64 + m.round(rv(balOffset / ri(2,3))) * (rf() < .5 ? -1 : 1) + sideBias)));
  refVar=ri(1,10); cBal2=rf()<.5?cBal+m.round(refVar*.5) : cBal+m.round(refVar*-.5);
  bassVar=refVar*rf(-2,2); cBal3=rf()<.5?cBal2+m.round(bassVar*.5) : cBal2+m.round(bassVar*-.5);

  // Sync instance state back to legacy naked globals so tests that mutate globals pass
  // Globals are populated via require-side effects; no explicit wrapper assignment required.

  p(c,...['control_c'].flatMap(()=>{ const tmp={ tick:m.max(0,beatStart-1),type:'control_c' }; fxEventTemplate=tmp;
return [
    ...source2.map(ch=>({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? lBal : rBal) : ch.toString().startsWith('rCH') ? (flipBin ? rBal : lBal) : ch===drumCH ? cBal3+m.round((rf(-.5,.5)*bassVar)) : cBal]})),
    ...reflection.map(ch=>({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? (rf()<.1 ? lBal+refVar*2 : lBal+refVar) : (rf()<.1 ? rBal-refVar*2 : rBal-refVar)) : ch.toString().startsWith('rCH') ? (flipBin ? (rf()<.1 ? rBal-refVar*2 : rBal-refVar) : (rf()<.1 ? lBal+refVar*2 : lBal+refVar)) : cBal2+m.round((rf(-.5,.5)*refVar)) ]})),
    ...bass.map(ch=>({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (flipBin ? lBal+bassVar : rBal-bassVar) : ch.toString().startsWith('rCH') ? (flipBin ? rBal-bassVar : lBal+bassVar) : cBal3+m.round((rf(-.5,.5)*bassVar)) ]})),
    ...source2.map(ch=>rfx('source',ch,1,(c)=>c===cCH1)),
    ...source2.map(ch=>rfx('source',ch,5,(c)=>c===cCH1)),
    ...source2.map(ch=>rfx('source',ch,11,(c)=>c===cCH1||c===drumCH)),
    ...source2.map(ch=>rfx('source',ch,65,(c)=>c===cCH1)),
    ...source2.map(ch=>rfx('source',ch,67)),
    ...source2.map(ch=>rfx('source',ch,68)),
    ...source2.map(ch=>rfx('source',ch,69)),
    ...source2.map(ch=>rfx('source',ch,70)),
    ...source2.map(ch=>rfx('source',ch,71)),
    ...source2.map(ch=>rfx('source',ch,72)),
    ...source2.map(ch=>rfx('source',ch,73)),
    ...source2.map(ch=>rfx('source',ch,74)),
    ...source2.map(ch=>rfx('source',ch,91)),
    ...source2.map(ch=>rfx('source',ch,92)),
    ...source2.map(ch=>rfx('source',ch,93)),
    ...source2.map(ch=>rfx('source',ch,94,(c)=>c===drumCH)),
    ...source2.map(ch=>rfx('source',ch,95)),
    ...reflection.map(ch=>rfx('reflection',ch,1,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,5,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,11,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,65,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,67)),
    ...reflection.map(ch=>rfx('reflection',ch,68)),
    ...reflection.map(ch=>rfx('reflection',ch,69)),
    ...reflection.map(ch=>rfx('reflection',ch,70)),
    ...reflection.map(ch=>rfx('reflection',ch,71)),
    ...reflection.map(ch=>rfx('reflection',ch,72)),
    ...reflection.map(ch=>rfx('reflection',ch,73)),
    ...reflection.map(ch=>rfx('reflection',ch,74)),
    ...reflection.map(ch=>rfx('reflection',ch,91,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,92,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,93,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,94,(c)=>c===cCH2)),
    ...reflection.map(ch=>rfx('reflection',ch,95,(c)=>c===cCH2)),
    ...bass.map(ch=>rfx('bass',ch,1,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,5,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,11,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,65,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,67)),
    ...bass.map(ch=>rfx('bass',ch,68)),
    ...bass.map(ch=>rfx('bass',ch,69)),
    ...bass.map(ch=>rfx('bass',ch,70)),
    ...bass.map(ch=>rfx('bass',ch,71)),
    ...bass.map(ch=>rfx('bass',ch,72)),
    ...bass.map(ch=>rfx('bass',ch,73)),
    ...bass.map(ch=>rfx('bass',ch,74)),
    ...bass.map(ch=>rfx('bass',ch,91,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,92,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,93,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,94,(c)=>c===cCH3)),
    ...bass.map(ch=>rfx('bass',ch,95,(c)=>c===cCH3)),
  ];  })  );

  // ── Texture-reactive FX modulation (#5) — conductor-driven ────────
  // When texture contrast intensity is high, boost reverb send (CC91),
  // open filter cutoff (CC74), and spike delay send (CC94) so the spatial
  // environment breathes with the texture system.
  // FX depth and texture boost amplitude are scaled by the active conductor profile.
  const fxScale = ConductorConfig.getFxMixScaling();

  if (DrumTextureCoupler) {
    const texInt = DrumTextureCoupler.getIntensity();
    if (Number.isFinite(texInt) && texInt > 0.1) {
      const allChs = [
        ...(Array.isArray(source2) ? source2 : []),
        ...(Array.isArray(reflection) ? reflection : []),
        ...(Array.isArray(bass) ? bass : [])
      ];
      const reverbBoost = m.round(texInt * rf(8, 20) * fxScale.reverbScale * fxScale.textureBoostScale);
      const filterBoost = m.round(texInt * rf(5, 15) * fxScale.filterOpenness * fxScale.textureBoostScale);
      const delaySpike = m.round(texInt * rf(4, 12) * fxScale.delayScale * fxScale.textureBoostScale);
      const texTick = beatStart;

      const clampToFxDefault = (ch, effectNum, value) => {
        // determine group for the channel
        const group = (Array.isArray(reflection) && reflection.includes(ch)) ? 'reflection' : (Array.isArray(bass) && bass.includes(ch)) ? 'bass' : 'source';
        let def = null;
        if (FX_CC_DEFAULTS) {
          if (FX_CC_DEFAULTS[group] && FX_CC_DEFAULTS[group][effectNum]) def = FX_CC_DEFAULTS[group][effectNum];
          else if (FX_CC_DEFAULTS[effectNum]) def = FX_CC_DEFAULTS[effectNum];
        }
        if (def && Number.isFinite(Number(def.min)) && Number.isFinite(Number(def.max))) {
          const v = m.round(m.max(def.min, m.min(def.max, Number(value))));
          return v;
        }
        return clamp(Number(value), 0, MIDI_MAX_VALUE);
      };

      for (let ti = 0; ti < allChs.length; ti++) {
        const tCh = allChs[ti];
        p(c, { tick: texTick, type: 'control_c', vals: [tCh, 91, clampToFxDefault(tCh, 91, reverbBoost)] }); // Reverb
        p(c, { tick: texTick, type: 'control_c', vals: [tCh, 74, clampToFxDefault(tCh, 74, 80 + filterBoost)] }); // Filter cutoff
        if (texInt > 0.25) {
          p(c, { tick: texTick, type: 'control_c', vals: [tCh, 94, clampToFxDefault(tCh, 94, delaySpike)] }); // Delay
        }
      }
    }
  }
  // Fail-fast: verify pan events were generated by the main logic above.
  // Only scan events added during THIS call — never the full ever-growing buffer.
  if (c.length > _cLenBeforeFX) {
    let _hasPan = false;
    for (let i = _cLenBeforeFX; i < c.length; i++) {
      if (c[i].vals && c[i].vals[1] === 10) { _hasPan = true; break; }
    }
    if (!_hasPan) {
      throw new Error('setBalanceAndFX: main FX block produced zero pan events — logic error');
    }
  }
}
}
