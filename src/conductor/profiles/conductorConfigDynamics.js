conductorConfigDynamics = ({ getActiveProfile, getActiveProfileName, setActiveProfile }) => {
  const V = Validator.create('conductorConfigDynamics');

  const controls = CONDUCTOR_DYNAMICS_CONTROLS || {
        phaseProfileMap: {
          intro: 'restrained',
          opening: 'restrained',
          exposition: 'default',
          development: 'default',
          climax: 'explosive',
          resolution: 'atmospheric',
          conclusion: 'atmospheric',
          coda: 'minimal'
        },
        crossfadeMeasuresDefault: 4,
        regulation: {
          windowSize: 16,
          highThreshold: 0.78,
          lowThreshold: 0.25,
          maxDensityBias: 0.12,
          maxCrossModBias: 0.3,
          adjustRate: 0.02,
          settleDecay: 0.9,
          crossModSampleDivisor: 6
        }
      };
  const regulationCfg = (controls.regulation && typeof controls.regulation === 'object') ? controls.regulation : {};

  const crossfade = {
    from: null,
    to: null,
    measuresTotal: Number.isFinite(Number(controls.crossfadeMeasuresDefault)) ? m.max(1, Number(controls.crossfadeMeasuresDefault)) : 4,
    measuresCurrent: 0,
    active: false
  };

  const regulation = {
    window: /** @type {number[]} */ ([]),
    windowSize: Number.isFinite(Number(regulationCfg.windowSize)) ? m.max(2, Number(regulationCfg.windowSize)) : 16,
    highThreshold: Number.isFinite(Number(regulationCfg.highThreshold)) ? Number(regulationCfg.highThreshold) : 0.78,
    lowThreshold: Number.isFinite(Number(regulationCfg.lowThreshold)) ? Number(regulationCfg.lowThreshold) : 0.25,
    densityBias: 0,
    crossModBias: 1.0,
    maxDensityBias: Number.isFinite(Number(regulationCfg.maxDensityBias)) ? m.max(0, Number(regulationCfg.maxDensityBias)) : 0.12,
    maxCrossModBias: Number.isFinite(Number(regulationCfg.maxCrossModBias)) ? m.max(0, Number(regulationCfg.maxCrossModBias)) : 0.3,
    adjustRate: Number.isFinite(Number(regulationCfg.adjustRate)) ? m.max(0, Number(regulationCfg.adjustRate)) : 0.02,
    settleDecay: Number.isFinite(Number(regulationCfg.settleDecay)) ? clamp(Number(regulationCfg.settleDecay), 0, 1) : 0.9,
    crossModSampleDivisor: Number.isFinite(Number(regulationCfg.crossModSampleDivisor)) ? m.max(0.1, Number(regulationCfg.crossModSampleDivisor)) : 6
  };

  const PHASE_PROFILE_MAP = (controls.phaseProfileMap && typeof controls.phaseProfileMap === 'object')
    ? controls.phaseProfileMap
    : {
        intro: 'restrained',
        opening: 'restrained',
        exposition: 'default',
        development: 'default',
        climax: 'explosive',
        resolution: 'atmospheric',
        conclusion: 'atmospheric',
        coda: 'minimal'
      };

  const lerpObject = (a, b, t) => {
    const result = {};
    for (const key of Object.keys(b)) {
      const av = a[key];
      const bv = b[key];
      if (typeof bv === 'number' && typeof av === 'number') {
        result[key] = av + (bv - av) * t;
      } else if (Array.isArray(bv) && Array.isArray(av) && av.length === bv.length) {
        result[key] = bv.map((value, index) => typeof value === 'number' && typeof av[index] === 'number' ? av[index] + (value - av[index]) * t : value);
      } else if (bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object') {
        result[key] = lerpObject(av, bv, t);
      } else {
        result[key] = bv;
      }
    }
    return result;
  };

  const resolveField = (field) => {
    const target = getActiveProfile()[field];
    if (!crossfade.active || !crossfade.from) return target;

    const t = m.min(crossfade.measuresCurrent / m.max(crossfade.measuresTotal, 1), 1);
    if (t >= 1) return target;

    const fromValue = crossfade.from[field];
    if (typeof fromValue === 'number' && typeof target === 'number') {
      return fromValue + (target - fromValue) * t;
    }
    if (!fromValue || typeof fromValue !== 'object') return target;

    return lerpObject(fromValue, target, t);
  };

  const tickCrossfade = () => {
    if (!crossfade.active) return;
    crossfade.measuresCurrent++;
    if (crossfade.measuresCurrent >= crossfade.measuresTotal) {
      crossfade.active = false;
      crossfade.from = null;
    }
  };

  const regulationTick = () => {
    const crossModSample = (Number.isFinite(crossModulation))
      ? clamp(crossModulation / regulation.crossModSampleDivisor, 0, 1)
      : 0.5;

    regulation.window.push(crossModSample);
    if (regulation.window.length > regulation.windowSize) {
      regulation.window.shift();
    }

    if (regulation.window.length < regulation.windowSize * 0.5) return;

    const avg = regulation.window.reduce((sum, value) => sum + value, 0) / regulation.window.length;

    if (avg > regulation.highThreshold) {
      regulation.densityBias = clamp(
        regulation.densityBias - regulation.adjustRate,
        -regulation.maxDensityBias,
        regulation.maxDensityBias
      );
      regulation.crossModBias = clamp(
        regulation.crossModBias - regulation.adjustRate * 0.5,
        1 - regulation.maxCrossModBias,
        1 + regulation.maxCrossModBias
      );
    } else if (avg < regulation.lowThreshold) {
      regulation.densityBias = clamp(
        regulation.densityBias + regulation.adjustRate,
        -regulation.maxDensityBias,
        regulation.maxDensityBias
      );
      regulation.crossModBias = clamp(
        regulation.crossModBias + regulation.adjustRate * 0.5,
        1 - regulation.maxCrossModBias,
        1 + regulation.maxCrossModBias
      );
    } else {
      regulation.densityBias *= regulation.settleDecay;
      regulation.crossModBias = 1 + (regulation.crossModBias - 1) * regulation.settleDecay;
    }

    if (EventBus && typeof EventBus.emit === 'function') {
      const EVENTS = V.getEventsOrThrow();
      EventBus.emit(EVENTS.CONDUCTOR_REGULATION, {
        avg,
        densityBias: regulation.densityBias,
        crossModBias: regulation.crossModBias,
        profile: getActiveProfileName()
      });
    }
  };

  const getRegulationDensityBias = () => regulation.densityBias;

  const getRegulationCrossModBias = () => regulation.crossModBias;

  const getTargetDensityRegulated = (compositeIntensity) => {
    const densityProfile = resolveField('density');
    const [lo, hi] = densityProfile.range;
    const biasedLo = clamp(lo + regulation.densityBias, 0, 1);
    const biasedHi = clamp(hi + regulation.densityBias, 0, 1);
    return biasedLo + (biasedHi - biasedLo) * compositeIntensity;
  };

  const applyPhaseProfile = (opts = {}) => {
    const phase = (HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('sectionPhase') || 'development')
      : 'development';

    const profileName = PHASE_PROFILE_MAP[phase] || 'default';
    const outgoing = getActiveProfile();
    const outgoingName = getActiveProfileName();

    setActiveProfile(profileName);

    if (outgoingName !== profileName) {
      crossfade.from = outgoing;
      crossfade.to = getActiveProfile();
      crossfade.measuresTotal = (Number.isFinite(Number(opts.crossfadeMeasures)))
        ? m.max(1, Number(opts.crossfadeMeasures))
        : (Number.isFinite(Number(controls.crossfadeMeasuresDefault)) ? m.max(1, Number(controls.crossfadeMeasuresDefault)) : 4);
      crossfade.measuresCurrent = 0;
      crossfade.active = true;
    }

    return profileName;
  };

  return {
    resolveField,
    tickCrossfade,
    regulationTick,
    getRegulationDensityBias,
    getRegulationCrossModBias,
    getTargetDensityRegulated,
    applyPhaseProfile
  };
};
