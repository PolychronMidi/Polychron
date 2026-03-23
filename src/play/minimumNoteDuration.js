const V = validator.create('minimumNoteDuration');

minimumNoteDuration = (() => {
  const CORE_MIN_MS = 90;
  const ORNAMENT_MIN_MS = 65;
  const CORE_UNIT_RATIO = 0.22;
  const ORNAMENT_UNIT_RATIO = 0.14;
  const floorCache = new Map();

  function getFloorTicks(kind, unitTicks) {
    const timingUnit = V.optionalFinite(unitTicks, tpUnit);
    const ticksPerSecond = V.requireFinite(tpSec, 'tpSec');
    const cacheKey = `${kind}:${timingUnit}:${ticksPerSecond}`;
    const cached = floorCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const minMs = kind === 'ornament' ? ORNAMENT_MIN_MS : CORE_MIN_MS;
    const ratio = kind === 'ornament' ? ORNAMENT_UNIT_RATIO : CORE_UNIT_RATIO;
    const floorFromMs = ticksPerSecond * (minMs / 1000);
    const floorFromUnit = V.requireFinite(timingUnit, 'timingUnit') * ratio;
    const floor = m.max(floorFromMs, floorFromUnit);
    floorCache.set(cacheKey, floor);
    return floor;
  }

  return {
    floorTicks(kind, unitTicks) {
      return getFloorTicks(kind, unitTicks);
    },

    resolveOffTick(onTick, desiredOffTick, kind, unitTicks, label) {
      const onTickValue = V.requireFinite(onTick, 'onTick');
      const desiredTickValue = V.requireFinite(desiredOffTick, label || 'desiredOffTick');
      return m.max(onTickValue + getFloorTicks(kind, unitTicks), desiredTickValue);
    }
  };
})();
