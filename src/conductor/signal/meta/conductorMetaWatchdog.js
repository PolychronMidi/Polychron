// conductorMetaWatchdog.js - Meta-controller interaction watchdog.
// Monitors telemetry from meta-controllers (#10) every 50 beats and detects
// opposing correction patterns. When two controllers apply corrections of
// opposite sign to the same axis for >30 of the last 50 beats, the weaker
// controller is attenuated by 50%. This is the "immune system" for the
// meta-controller layer, preventing controller-vs-controller conflicts
// from cancelling each other out (e.g. R6 centroid vs elasticity on flicker).

moduleLifecycle.declare({
  name: 'conductorMetaWatchdog',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'validator'],
  provides: ['conductorMetaWatchdog'],
  init: (deps) => {
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('conductorMetaWatchdog');

  const _CHECK_INTERVAL = 50;      // run watchdog every N beats
  const _CONFLICT_THRESHOLD = 55;  // out of 100 beats, opposing > this triggers attenuation
  const _ATTENUATION_FACTOR = 0.50; // weaker controller attenuated by this factor
  const _RING_SIZE = 100;

  let conductorMetaWatchdogBeatCounter = 0;

  // Track per-axis correction signs from different meta-controllers.
  // Key: "pipeline:controller", Value: ring buffer of correction signs (-1, 0, +1)
  /** @type {Map<string, number[]>} */
  const conductorMetaWatchdogCorrectionRings = new Map();

  // Active attenuations: pipeline -> controller name -> attenuation multiplier
  /** @type {Map<string, Map<string, number>>} */
  const conductorMetaWatchdogAttenuations = new Map();

  /**
   * Get the current attenuation multiplier for a given pipeline + controller.
   * Other modules can query this to self-attenuate when the watchdog flags them.
   * @param {string} pipeline
   * @param {string} controllerName
   * @returns {number} multiplier 0..1 (1.0 = no attenuation)
   */
  function getAttenuation(pipeline, controllerName) {
    const pipelineMap = conductorMetaWatchdogAttenuations.get(pipeline);
    if (!pipelineMap) return 1.0;
    return V.optionalFinite(pipelineMap.get(controllerName), 1.0);
  }

  /**
   * Record a correction observation from a meta-controller.
   * Called by conductorDampening's telemetry emitter or by controllers directly.
   * @param {string} pipeline - e.g. 'density', 'tension', 'flicker'
   * @param {string} controllerName - e.g. 'centroid', 'elasticity', 'equilibrator'
   * @param {number} correctionSign - -1, 0, or +1 direction of correction
   */
  function recordCorrection(pipeline, controllerName, correctionSign) {
    const key = pipeline + ':' + controllerName;
    let ring = conductorMetaWatchdogCorrectionRings.get(key);
    if (!ring) {
      ring = [];
      conductorMetaWatchdogCorrectionRings.set(key, ring);
    }
    ring.push(m.sign(correctionSign));
    if (ring.length > _RING_SIZE) ring.shift();
  }

  /** Run the conflict detection analysis. */
  function conductorMetaWatchdogAnalyze() {
    // Group corrections by pipeline
    /** @type {Map<string, string[]>} */
    const controllersByPipeline = new Map();
    for (const key of conductorMetaWatchdogCorrectionRings.keys()) {
      const parts = key.split(':');
      const pipeline = parts[0];
      const controller = parts[1];
      let controllers = controllersByPipeline.get(pipeline);
      if (!controllers) {
        controllers = [];
        controllersByPipeline.set(pipeline, controllers);
      }
      controllers.push(controller);
    }

    for (const [pipeline, controllers] of controllersByPipeline.entries()) {
      if (controllers.length < 2) continue;

      // Check all pairs of controllers on this pipeline for opposing corrections
      for (let i = 0; i < controllers.length; i++) {
        for (let j = i + 1; j < controllers.length; j++) {
          const ringA = conductorMetaWatchdogCorrectionRings.get(pipeline + ':' + controllers[i]);
          const ringB = conductorMetaWatchdogCorrectionRings.get(pipeline + ':' + controllers[j]);
          if (!ringA || !ringB) continue;

          const len = m.min(ringA.length, ringB.length, _RING_SIZE);
          if (len < _RING_SIZE * 0.6) continue; // need enough data

          let opposingCount = 0;
          let sumMagA = 0;
          let sumMagB = 0;
          const startIdx = m.max(0, len - _RING_SIZE);
          for (let k = startIdx; k < len; k++) {
            const idxA = ringA.length - len + k;
            const idxB = ringB.length - len + k;
            if (ringA[idxA] !== 0 && ringB[idxB] !== 0 && ringA[idxA] !== ringB[idxB]) {
              opposingCount++;
            }
            sumMagA += m.abs(ringA[idxA]);
            sumMagB += m.abs(ringB[idxB]);
          }

          if (opposingCount > _CONFLICT_THRESHOLD) {
            // Attenuate the weaker controller (lower total magnitude)
            const weakerController = sumMagA <= sumMagB ? controllers[i] : controllers[j];
            const strongerController = sumMagA > sumMagB ? controllers[i] : controllers[j];

            let pipelineMap = conductorMetaWatchdogAttenuations.get(pipeline);
            if (!pipelineMap) {
              pipelineMap = new Map();
              conductorMetaWatchdogAttenuations.set(pipeline, pipelineMap);
            }
            const currentAtten = V.optionalFinite(pipelineMap.get(weakerController), 1.0);
            const newAtten = clamp(currentAtten * _ATTENUATION_FACTOR, 0.1, 1.0);
            pipelineMap.set(weakerController, newAtten);

            safePreBoot.call(() => explainabilityBus.emit('meta-watchdog-conflict', 'both', {
              pipeline,
              controllerA: controllers[i],
              controllerB: controllers[j],
              opposingBeats: opposingCount,
              attenuated: weakerController,
              stronger: strongerController,
              attenuation: newAtten
            }));
          } else {
            // No conflict: relax attenuations toward 1.0
            const pipelineMap = conductorMetaWatchdogAttenuations.get(pipeline);
            if (pipelineMap) {
              for (const ctrl of [controllers[i], controllers[j]]) {
                const current = pipelineMap.get(ctrl);
                if (current && current < 1.0) {
                  const relaxed = clamp(current + 0.1, 0, 1.0);
                  if (relaxed >= 0.99) pipelineMap.delete(ctrl);
                  else pipelineMap.set(ctrl, relaxed);
                }
              }
            }
          }
        }
      }
    }
  }

  /** Called each beat via conductor recorder. */
  function tick() {
    conductorMetaWatchdogBeatCounter++;

    // Read telemetry from explainabilityBus meta-dampening events to
    // auto-populate correction records. This is passive - controllers
    // can also call recordCorrection() directly for richer data.
    // The centroid correction sign tells us the direction per pipeline.
    // The flicker dampening adj sign tells us elasticity direction.

    if (conductorMetaWatchdogBeatCounter % _CHECK_INTERVAL === 0) {
      conductorMetaWatchdogAnalyze();
    }
  }

  function getSnapshot() {
    /** @type {Record<string, Record<string, number>>} */
    const snapshot = {};
    for (const [pipeline, pipelineMap] of conductorMetaWatchdogAttenuations.entries()) {
      snapshot[pipeline] = {};
      for (const [ctrl, atten] of pipelineMap.entries()) {
        snapshot[pipeline][ctrl] = atten;
      }
    }
    return snapshot;
  }

  function reset() {
    conductorMetaWatchdogBeatCounter = 0;
    conductorMetaWatchdogCorrectionRings.clear();
    conductorMetaWatchdogAttenuations.clear();
  }

  // Self-registration
  conductorIntelligence.registerRecorder('conductorMetaWatchdog', tick);
  conductorIntelligence.registerStateProvider('conductorMetaWatchdog', () => ({
    watchdogAttenuations: getSnapshot()
  }));
  conductorIntelligence.registerModule('conductorMetaWatchdog', { reset }, ['section']);

  function signalContradiction(pipeline, weakerController) {
    let pipelineMap = conductorMetaWatchdogAttenuations.get(pipeline);
    if (!pipelineMap) {
      pipelineMap = new Map();
      conductorMetaWatchdogAttenuations.set(pipeline, pipelineMap);
    }
    const current = V.optionalFinite(pipelineMap.get(weakerController), 1.0);
    pipelineMap.set(weakerController, clamp(current * 0.85, 0.1, 1.0));
  }

  return { recordCorrection, getAttenuation, signalContradiction, getSnapshot, reset };
  },
});
