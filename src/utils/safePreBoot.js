// safePreBoot.js - Standardized pre-boot catch utility.
// Many modules may be called before their dependencies have finished
// initializing (e.g. explainabilityBus, conductorMetaWatchdog during
// early beats). This utility replaces the ad-hoc try/catch { /* pre-boot */ }
// pattern with a single named function for consistency and grepability.

safePreBoot = (() => {
  const V = validator.create('safePreBoot');

  /**
   * Execute `fn` and return its result. If it throws (typically because a
   * dependency hasn't booted yet), return `fallback` instead.
   * @template T
   * @param {() => T} fn - thunk to attempt
   * @param {T} [fallback] - value to return on failure (default: undefined)
   * @returns {T | undefined}
   */
  function call(fn, fallback) {
    V.requireType(fn, 'function', 'fn');
    try {
      return fn();
    } catch { /* boot-safety: dependency may not be ready */
      return fallback;
    }
  }

  return { call };
})();
