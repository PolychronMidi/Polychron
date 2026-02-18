conductorConfigDynamics = ({ getActiveProfile, getActiveProfileName, setActiveProfile }) => {
  const crossfade = {
    from: null,
    to: null,
    measuresTotal: 4,
    measuresCurrent: 0,
    active: false
  };

  const regulation = {
    window: /** @type {number[]} */ ([]),
    windowSize: 16,
    highThreshold: 0.78,
    lowThreshold: 0.25,
    densityBias: 0,
    crossModBias: 1.0,
    maxDensityBias: 0.12,
    maxCrossModBias: 0.3,
    adjustRate: 0.02
  };

  const PHASE_PROFILE_MAP = {
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
    const crossModSample = (typeof crossModulation === 'number' && Number.isFinite(crossModulation))
      ? clamp(crossModulation / 6, 0, 1)
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
      regulation.densityBias *= 0.9;
      regulation.crossModBias = 1 + (regulation.crossModBias - 1) * 0.9;
    }

    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') {
      EventBus.emit('conductor-regulation', {
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
    const phase = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
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
        : 4;
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
