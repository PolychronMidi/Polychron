// beatCache.js - Per-beat memoization for expensive conductor queries.
// Many conductor modules register both a bias getter AND a stateProvider,
// both calling the same costly function (typically querying absoluteTimeWindow).
// This factory wraps such functions so the computation runs at most once per beat.
// Cache auto-invalidates because beatCount increments each beat.

beatCache = (() => {
  /**
   * Wrap an expensive function so it runs at most once per beat.
   * @param {Function} fn - the expensive computation (no args)
   * @returns {{ get: () => any }}
   */
  function create(fn) {
    let cachedBeat = -1;
    let cachedResult = null;

    function get() {
      const beat = beatCount;
      if (beat === cachedBeat && cachedResult !== null) return cachedResult;
      cachedResult = fn();
      cachedBeat = beat;
      return cachedResult;
    }

    return { get };
  }

  return { create };
})();
