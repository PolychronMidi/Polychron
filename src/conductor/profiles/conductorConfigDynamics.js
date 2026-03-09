conductorConfigDynamics = ({ getActiveProfile, getActiveProfileName, setActiveProfile }) => {
  const V = validator.create('conductorConfigDynamics');

  const controls = CONDUCTOR_DYNAMICS_CONTROLS;
  const regulationCfg = (controls.regulation && typeof controls.regulation === 'object') ? controls.regulation : {};

  const crossfade = {
    from: null,
    to: null,
    measuresTotal: m.max(1, V.optionalFinite(Number(controls.crossfadeMeasuresDefault), 4)),
    measuresCurrent: 0,
    active: false
  };

  const regulation = {
    window: /** @type {number[]} */ ([]),
    windowSize: m.max(2, V.optionalFinite(Number(regulationCfg.windowSize), 16)),
    highThreshold: V.optionalFinite(Number(regulationCfg.highThreshold), 0.78),
    lowThreshold: V.optionalFinite(Number(regulationCfg.lowThreshold), 0.25),
    densityBias: 0,
    crossModBias: 1.0,
    maxDensityBias: m.max(0, V.optionalFinite(Number(regulationCfg.maxDensityBias), 0.12)),
    maxCrossModBias: m.max(0, V.optionalFinite(Number(regulationCfg.maxCrossModBias), 0.3)),
    adjustRate: m.max(0, V.optionalFinite(Number(regulationCfg.adjustRate), 0.02)),
    settleDecay: clamp(V.optionalFinite(Number(regulationCfg.settleDecay), 0.9), 0, 1),
    crossModSampleDivisor: m.max(0.1, V.optionalFinite(Number(regulationCfg.crossModSampleDivisor), 6))
  };

  const PHASE_PROFILE_MAP = (controls.phaseProfileMap && typeof controls.phaseProfileMap === 'object')
    ? controls.phaseProfileMap
    : {
        intro: 'restrained',
        opening: 'restrained',
        exposition: 'default',
        development: 'default',
        climax: 'explosive',
        // R71 E4: Reverted to atmospheric (was explosive in R70 E6).
        // Tests R70 E4 phaseVarianceGateScale 0.12 and gives same-profile
        // .prev comparison against R69 atmospheric.
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
    if (!V.optionalType(fromValue, 'object')) return target;

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
    const crossModSample = clamp(
      V.optionalFinite(crossModulation, 0.5) / regulation.crossModSampleDivisor,
      0, 1
    );

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

    if (eventBus) {
      const EVENTS = V.getEventsOrThrow();
      eventBus.emit(EVENTS.CONDUCTOR_REGULATION, {
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
    const phase = harmonicContext.getField('sectionPhase');

    const profileName = PHASE_PROFILE_MAP[phase] || 'default';
    const outgoing = getActiveProfile();
    const outgoingName = getActiveProfileName();

    setActiveProfile(profileName);

    if (outgoingName !== profileName) {
      crossfade.from = outgoing;
      crossfade.to = getActiveProfile();
      crossfade.measuresTotal = m.max(1, V.optionalFinite(
        Number(opts.crossfadeMeasures),
        V.optionalFinite(Number(controls.crossfadeMeasuresDefault), 4)
      ));
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
