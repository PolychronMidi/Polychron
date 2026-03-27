const V = validator.create('minimumNoteDuration');

minimumNoteDuration = (() => {
  const CORE_MIN_S = 0.090;
  const ORNAMENT_MIN_S = 0.065;
  const CORE_UNIT_RATIO = 0.22;
  const ORNAMENT_UNIT_RATIO = 0.14;
  const floorCache = new Map();

  function getFloorSeconds(kind, unitSecs) {
    const timingUnit = V.optionalFinite(unitSecs, spUnit);
    const cacheKey = `${kind}:${timingUnit}`;
    const cached = floorCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const minS = kind === 'ornament' ? ORNAMENT_MIN_S : CORE_MIN_S;
    const ratio = kind === 'ornament' ? ORNAMENT_UNIT_RATIO : CORE_UNIT_RATIO;
    const floorFromMs = minS;
    const floorFromUnit = V.requireFinite(timingUnit, 'timingUnit') * ratio;
    const floor = m.max(floorFromMs, floorFromUnit);
    floorCache.set(cacheKey, floor);
    return floor;
  }

  return {
    floorTicks(kind, unitSecs) {
      return getFloorSeconds(kind, unitSecs);
    },

    resolveOffTick(onTime, desiredOffTime, kind, unitSecs, label) {
      const onTimeValue = V.requireFinite(onTime, 'onTime');
      const desiredTimeValue = V.requireFinite(desiredOffTime, label || 'desiredOffTime');
      return m.max(onTimeValue + getFloorSeconds(kind, unitSecs), desiredTimeValue);
    }
  };
})();
