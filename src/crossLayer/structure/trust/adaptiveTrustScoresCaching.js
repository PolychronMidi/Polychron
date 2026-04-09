// src/crossLayer/structure/trust/adaptiveTrustScoresCaching.js
// Cache key/version management and weight/snapshot caching for adaptiveTrustScores.

adaptiveTrustScoresCaching = (() => {
  let cacheVersion = 0;
  let contextCacheKey = '';
  let contextCache = null;
  let weightCacheKey = '';
  const weightCache = new Map();
  let snapshotCacheKey = '';
  let snapshotCache = null;

  function getBeatKey() {
    const safeSection = Number.isFinite(sectionIndex) ? sectionIndex : -1;
    const safePhrase = Number.isFinite(phraseIndex) ? phraseIndex : -1;
    const safeBeat = Number.isFinite(beatStartTime) ? beatStartTime : (Number.isFinite(beatCount) ? beatCount : -1);
    return safeSection + ':' + safePhrase + ':' + safeBeat;
  }

  function getCacheKey() {
    return getBeatKey() + ':' + cacheVersion;
  }

  function invalidateValueCaches() {
    cacheVersion++;
    weightCacheKey = '';
    weightCache.clear();
    snapshotCacheKey = '';
    snapshotCache = null;
  }

  /** @returns {{ regime: string, tensionShare: number, trustShare: number, phaseShare: number, trustAxisPressure: number, phaseLaneNeed: number }} */
  function resolveContext() {
    const beatKey = getBeatKey();
    if (contextCacheKey === beatKey && contextCache) return contextCache;
    const bridgeSigs = conductorSignalBridge.getSignals();
    const regime = bridgeSigs.regime || 'evolving';
    const axisShares = bridgeSigs.axisEnergyShares;
    const tensionShare = axisShares && typeof axisShares.tension === 'number'
      ? axisShares.tension
      : 1.0 / 6.0;
    const trustShare = axisShares && typeof axisShares.trust === 'number'
      ? axisShares.trust
      : 1.0 / 6.0;
    const phaseShare = axisShares && typeof axisShares.phase === 'number'
      ? axisShares.phase
      : 1.0 / 6.0;
    contextCacheKey = beatKey;
    contextCache = {
      regime,
      tensionShare,
      trustShare,
      phaseShare,
      trustAxisPressure: clamp((trustShare - 0.17) / 0.08, 0, 1),
      phaseLaneNeed: clamp((0.07 - phaseShare) / 0.07, 0, 1)
    };
    return contextCache;
  }

  /** Check weight cache; returns cached value or undefined. */
  function getWeightCached(systemName) {
    const key = getCacheKey();
    if (weightCacheKey !== key) {
      weightCacheKey = key;
      weightCache.clear();
    }
    return weightCache.get(systemName);
  }

  /** Store a weight value in the cache. */
  function setWeightCached(systemName, value) {
    weightCache.set(systemName, value);
  }

  /** Check snapshot cache; returns cached snapshot or null. */
  function getSnapshotCached() {
    const key = getCacheKey();
    if (snapshotCacheKey !== key || !snapshotCache) return null;
    return snapshotCache;
  }

  /** Store snapshot in cache. */
  function setSnapshotCached(snapshot) {
    snapshotCacheKey = getCacheKey();
    snapshotCache = snapshot;
  }

  function resetCaches() {
    contextCacheKey = '';
    contextCache = null;
    invalidateValueCaches();
  }

  return { getBeatKey, getCacheKey, invalidateValueCaches, resolveContext, getWeightCached, setWeightCached, getSnapshotCached, setSnapshotCached, resetCaches };
})();
