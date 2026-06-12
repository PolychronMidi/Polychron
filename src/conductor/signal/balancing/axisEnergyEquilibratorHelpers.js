moduleLifecycle.declare({
  name: 'axisEnergyEquilibratorHelpers',
  subsystem: 'conductor',
  deps: [],
  lazyDeps: ['conductorConfig'],
  provides: ['axisEnergyEquilibratorHelpers'],
  init: () => {
  function getWarmupTicks(defaultWarmup) {
    let profile = null;
    try {
      profile = conductorConfig.getActiveProfile();
    } catch { /* boot-safety: dependency may not be ready */
      profile = null;
    }
    const analysis = profile && typeof profile.analysis === 'object' ? profile.analysis : null;
    const configuredWarmup = analysis && Number.isFinite(analysis.warmupTicks)
      ? m.round(analysis.warmupTicks)
      : 6;
    const shortRunCompression = Number.isFinite(totalSections) && totalSections > 0 && totalSections <= 5 ? 2 : 0;
    return clamp(configuredWarmup + 2 - shortRunCompression, 4, defaultWarmup);
  }

  function computeSurfacePressure(snapshot, pairs, ratio, absMin, hotspotThreshold, severeThreshold) {
    let surfaceHot = false;
    let surfacePressure = 0;
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const pairData = snapshot[pair];
      if (!pairData) continue;
      const baseline = pairData.baseline;
      const rolling = pairData.rawRollingAbsCorr;
      const pairP95 = typeof pairData.p95AbsCorr === 'number' ? pairData.p95AbsCorr : rolling;
      const hotspotRate = typeof pairData.hotspotRate === 'number' ? pairData.hotspotRate : 0;
      const severeRate = typeof pairData.severeRate === 'number' ? pairData.severeRate : 0;
      const pairPressure = clamp(
        clamp((rolling - m.max(absMin, baseline * ratio)) / 0.18, 0, 1) * 0.30 +
        clamp((pairP95 - m.max(absMin + 0.10, baseline * (ratio + 0.20))) / 0.16, 0, 1) * 0.40 +
        clamp((hotspotRate - hotspotThreshold) / 0.18, 0, 1) * 0.18 +
        clamp((severeRate - severeThreshold) / 0.10, 0, 1) * 0.12,
        0,
        1
      );
      if (pairPressure > 0) {
        surfaceHot = true;
        surfacePressure = m.max(surfacePressure, pairPressure);
      }
    }
    return { surfaceHot, surfacePressure };
  }

  return {
    computeSurfacePressure,
    getWarmupTicks,
  };
  },
});
