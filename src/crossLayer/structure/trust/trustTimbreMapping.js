// trustTimbreMapping.js - maps trust system dominance to GM instrument pools.
// Reads trustEcologyCharacter's dominant system and suggests complementary
// instrument families. Pools stay within timbral families to avoid whiplash.

trustTimbreMapping = (() => {
  // Family-coherent pools: pads, keys, strings, synths, ensemble
  const TRUST_INSTRUMENT_POOLS = {
    convergenceHarmonicTrigger: [89, 92, 97, 98],
    stutterContagion: [9, 12, 13, 14],
    harmonicIntervalGuard: [0, 4, 6, 11],
    motifEcho: [48, 49, 50, 51],
    temporalGravity: [79, 89, 104, 112]
  };

  let lastShiftTime = -Infinity;
  const SHIFT_INTERVAL = 10;

  function suggest(absoluteSeconds) {
    if (absoluteSeconds - lastShiftTime < SHIFT_INTERVAL) return null;
    const dominant = trustEcologyCharacter.getDominant();
    if (!dominant.system) return null;
    const pool = TRUST_INSTRUMENT_POOLS[dominant.system];
    if (!pool) return null;
    lastShiftTime = absoluteSeconds;
    return pool[ri(pool.length - 1)];
  }

  function reset() { lastShiftTime = -Infinity; }

  return { suggest, reset };
})();
crossLayerRegistry.register('trustTimbreMapping', trustTimbreMapping, ['all', 'section']);
