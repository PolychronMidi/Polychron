// stutterExecutePlan.js - shared executor for StutterManager plan objects

stutterExecutePlan = function stutterExecutePlan(stutterMgr, plan = {}) {
  const V = validator.create('stutterExecutePlan');
  if (!stutterMgr || typeof stutterMgr !== 'object') throw new Error('stutterExecutePlan: stutterMgr is required');
  const cfg = /** @type {any} */ (Object.assign({}, plan));
  if (!cfg.profile || typeof cfg.profile !== 'string') {
    throw new Error('stutterExecutePlan: plan.profile is required');
  }
  const profile = cfg.profile;
  const baseNote = V.requireFinite(cfg.note, 'plan.note');
  const on = V.optionalFinite(Number(cfg.on), beatStart);
  const sustain = V.optionalFinite(Number(cfg.sustain), tpSec * 0.25);
  const numStutters = V.optionalFinite(Number(cfg.numStutters), m.max(1, ri(2, 6)));
  const duration = V.optionalFinite(Number(cfg.duration), m.max(0.001, (sustain / numStutters) * rf(.9, 1.1)));

  const finalChannels = /** @type {number[]} */ ([]);
  if (Array.isArray(cfg.channels) && cfg.channels.length > 0) {
    finalChannels.push(.../** @type {number[]} */ (cfg.channels.slice()));
  } else if (profile === 'reflection') {
    finalChannels.push(.../** @type {number[]} */ (reflection.slice()));
  } else if (profile === 'bass') {
    finalChannels.push(.../** @type {number[]} */ (bass.slice()));
  } else {
    finalChannels.push(.../** @type {number[]} */ (source.slice()));
  }

  const crossRules = stutterConfig.getCrossModRules();
  if (!crossRules || typeof crossRules !== 'object') {
    throw new Error('stutterExecutePlan: invalid crossRules from stutterConfig.getCrossModRules');
  }

  const directiveDefaults = stutterConfig.getDirectiveDefaults();
  if (!directiveDefaults || typeof directiveDefaults !== 'object') {
    throw new Error('stutterExecutePlan: invalid directive defaults from stutterConfig.getDirectiveDefaults');
  }
  const directive = Object.assign({}, directiveDefaults, (cfg.directive || {}));
  if (cfg.preset) {
    const preset = stutterConfig.getPreset(cfg.preset);
    if (preset && typeof preset === 'object') Object.assign(directive, preset);
  }

  let adaptiveCrossRules = null;
  if (directive.metricsAdaptive && directive.metricsAdaptive.enabled) {
    const metrics = stutterMetrics.getMetrics();
    const sens = V.optionalFinite(Number(directive.metricsAdaptive.sensitivity), 0.08);
    const adj = Object.assign({}, crossRules);
    ['source', 'reflection', 'bass'].forEach((p) => {
      const emitted = metrics.emittedByProfile && metrics.emittedByProfile[p] ? metrics.emittedByProfile[p] : 0;
      const scheduled = metrics.scheduledByProfile && metrics.scheduledByProfile[p] ? metrics.scheduledByProfile[p] : 1;
      const ratio = emitted / m.max(1, scheduled);
      if (ratio > 0.8 && adj.pan) {
        adj.pan.stutterRateScale = clamp(adj.pan.stutterRateScale + (ratio - 0.8) * sens, 0.8, 3);
      }
    });
    adaptiveCrossRules = adj;
  }

  const prevCoherenceKey = (stutterMgr.beatContext && stutterMgr.beatContext.coherenceKey) ? stutterMgr.beatContext.coherenceKey : null;
  if (directive.coherence && directive.coherence.enabled) {
    if (!stutterMgr.beatContext) stutterMgr.beatContext = {};
    const prefix = directive.coherence.keyPrefix || 'stutter';
    const seedPart = cfg.coherenceGroup || cfg.coherenceKey || cfg.id || 'plan';
    stutterMgr.beatContext.coherenceKey = `${prefix}:${seedPart}`;
  }

  const leftCHs = [lCH1, lCH2, lCH3, lCH4, lCH5, lCH6].filter(Number.isFinite);
  const rightCHs = [rCH1, rCH2, rCH3, rCH4, rCH5, rCH6].filter(Number.isFinite);

  const evalCurve = (curve, t) => {
    if (!curve) return undefined;
    const tn = Number(t);
    if (typeof curve === 'function') return Number(curve(tn));
    if (Array.isArray(curve) && curve.length > 0) {
      const n = curve.length;
      const pos = clamp(tn * (n - 1), 0, n - 1);
      const idx = m.floor(pos);
      const frac = pos - idx;
      const a = V.requireFinite(curve[idx], 'curve[idx]');
      const b = V.requireFinite(curve[m.min(idx + 1, n - 1)], 'curve[idx+1]');
      return lerp(a, b, frac);
    }
    if (typeof curve === 'string') {
      switch (curve) {
        case 'linear': return 1;
        case 'accelerando': return 1 + Number(tn);
        case 'decelerando': return 1 + (1 - Number(tn));
        case 'sine': return 1 + m.sin(2 * m.PI * Number(tn)) * 0.25;
        case 'pingpong': {
          const frac = Number(tn) - m.floor(Number(tn));
          return m.abs((2 * frac) - 1);
        }
        case 'oscillate': return 0.5 + 0.5 * m.sin(2 * m.PI * Number(tn));
        default: {
          const numericCurve = Number(curve);
          if (!Number.isFinite(numericCurve)) {
            throw new Error(`stutterExecutePlan.evalCurve: unsupported curve value ${String(curve)}`);
          }
          return numericCurve;
        }
      }
    }
    return undefined;
  };

  const effectiveCrossRules = adaptiveCrossRules || crossRules;
  const baseStepPeriod = duration / m.max(1, Number(numStutters));
  for (let i = 0; i < numStutters; i++) {
    const tNorm = numStutters > 1 ? i / (numStutters - 1) : 0;
    const rateCurveVal = evalCurve(directive.rateCurve || cfg.rateCurve, tNorm) ?? 1;
    const phaseCurveVal = evalCurve(directive.phaseCurve || cfg.phaseCurve, tNorm);

    for (const ch of /** @type {any[]} */ (finalChannels)) {
      const side = leftCHs.includes(ch) ? 'left' : (rightCHs.includes(ch) ? 'right' : 'center');

      let basePhaseFraction = 0;
      const srcPhase = (directive.phase || cfg.phase);
      if (srcPhase !== undefined && srcPhase !== null) {
        if (Number.isFinite(Number(srcPhase))) basePhaseFraction = clamp(Number(srcPhase), 0, 1);
        else if (typeof srcPhase === 'object') {
          if (side === 'left' && Number.isFinite(Number(srcPhase.left))) basePhaseFraction = clamp(Number(srcPhase.left), 0, 1);
          else if (side === 'right' && Number.isFinite(Number(srcPhase.right))) basePhaseFraction = clamp(Number(srcPhase.right), 0, 1);
          else if (Number.isFinite(Number(srcPhase.center))) basePhaseFraction = clamp(Number(srcPhase.center), 0, 1);
          else if (Number.isFinite(Number(srcPhase.left)) && Number.isFinite(Number(srcPhase.right))) basePhaseFraction = clamp((Number(srcPhase.left) + Number(srcPhase.right)) / 2, 0, 1);
        }
      }

      const phaseFraction = Number.isFinite(Number(phaseCurveVal)) ? clamp(phaseCurveVal, 0, 1) * basePhaseFraction : basePhaseFraction;

      const chMod = (stutterMgr.beatContext && stutterMgr.beatContext.mod && stutterMgr.beatContext.mod[ch]) ? stutterMgr.beatContext.mod[ch] : null;
      const panAbs = (chMod && typeof chMod.pan === 'number') ? m.abs(chMod.pan) : 0;
      const rateScale = (effectiveCrossRules && effectiveCrossRules.pan && Number.isFinite(Number(effectiveCrossRules.pan.stutterRateScale)))
        ? (1 + panAbs * (Number(effectiveCrossRules.pan.stutterRateScale) - 1))
        : 1;

      const jitter = rf(.92, 1.08);
      const stepPeriodScaled = (baseStepPeriod / m.max(0.01, Number(rateCurveVal))) / m.max(0.01, rateScale);
      const stepTick = on + i * (stepPeriodScaled * jitter) + (phaseFraction * stepPeriodScaled);

      stutterNotes({ profile, channel: ch, note: baseNote, on: stepTick, sustain: duration, velocity: cfg.maxVelocity ?? 100, binVel: cfg.maxVelocity ?? 100, isPrimary: false, shared: stutterMgr.shared, beatContext: stutterMgr.beatContext });
    }
  }

  if (prevCoherenceKey !== null) {
    stutterMgr.beatContext.coherenceKey = prevCoherenceKey;
  } else if (stutterMgr.beatContext && stutterMgr.beatContext.coherenceKey && (cfg.coherenceKey || cfg.coherenceGroup || cfg.coherent)) {
    delete stutterMgr.beatContext.coherenceKey;
  }

  stutterMetrics.incEmitted(numStutters * /** @type {any[]} */ (finalChannels).length, profile);
  return cfg;
};
