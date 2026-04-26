// src/conductor/conductorRecorderRegistry.js - Sub-registry for beat recorders.
// Recorders receive a context object each beat and perform side-effects
// (recording snapshots, updating internal state).

moduleLifecycle.declare({
  name: 'conductorRecorderRegistry',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['conductorRecorderRegistry'],
  init: (deps) => {
  const V = deps.validator.create('conductorRecorderRegistry');

  /**
   * @typedef {{
   *   absTime: number,
   *   compositeIntensity: number,
   *   currentDensity: number,
   *   harmonicRhythm: number,
   *   layer: string
   * }} RecorderContext
   */
  /** @type {Array<{ name: string, fn: (ctx: RecorderContext) => void }>} */
  const recorders = [];

  /** @param {string} name */
  function conductorRecorderRegistryAssertNoDup(name) {
    if (recorders.some(e => e.name === name)) {
      throw new Error(`conductorRecorderRegistry.registerRecorder: duplicate name "${name}"`);
    }
  }

  /**
   * Register a recorder that runs each beat.
   * @param {string} name
   * @param {(ctx: RecorderContext) => void} fn
   */
  function registerRecorder(name, fn) {
    V.assertNonEmptyString(name, 'name');
    conductorRecorderRegistryAssertNoDup(name);
    V.requireType(fn, 'function', 'fn');
    recorders.push({ name, fn });
  }

  /**
   * Run all recorders with the given context.
   * @param {RecorderContext} ctx
   */
  function runRecorders(ctx) {
    // L2 pass only runs conductorSignalBridge (needs per-layer refresh).
    // All other recorders skip L2 to prevent double-counting from
    // polyrhythmic layer asymmetry.
    const l2Only = ctx && ctx.layer === 'L2';
    for (let i = 0; i < recorders.length; i++) {
      if (l2Only && recorders[i].name !== 'conductorSignalBridge') continue;
      recorders[i].fn(ctx);
    }
  }

  /** @returns {string[]} raw entry names (not colon-normalized) */
  function getNames() {
    return recorders.map(e => e.name);
  }

  /** @returns {number} */
  function getCount() {
    return recorders.length;
  }

  return { registerRecorder, runRecorders, getNames, getCount };
  },
});
