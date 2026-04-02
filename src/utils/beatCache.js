// beatCache.js - Per-beat memoization for expensive conductor queries.
// Many conductor modules register both a bias getter AND a stateProvider,
// both calling the same costly function (typically querying absoluteTimeWindow).
// This factory wraps such functions so the computation runs at most once per beat.
// Cache auto-invalidates because beatCount increments each beat.
// Layer-aware: includes active layer in cache key to prevent cross-layer stale hits.

beatCache = (() => {
  function create(fn) {
    let cachedBeat = -1;
    let cachedLayer = '';
    let cachedResult = null;

    function get() {
      const beat = beatCount;
      const layer = (LM && LM.activeLayer) ? LM.activeLayer : '';
      if (beat === cachedBeat && layer === cachedLayer && cachedResult !== null) return cachedResult;
      cachedResult = fn();
      cachedBeat = beat;
      cachedLayer = layer;
      return cachedResult;
    }

    return { get };
  }

  return { create };
})();
