// src/crossLayer/temporalGravity.js - Temporal gravity wells.
// Posts note density per ms window to ATG 'density' channel. When one layer
// hits a dense cluster, the other layer's note ticks get micro-pulled toward
// the cluster center - creating organic emergent rubato.

temporalGravity = (() => {
  const V = validator.create('temporalGravity');
  const DENSITY_CHANNEL = 'density';
  const DENSITY_WINDOW_MS = 300;
  const GRAVITY_TOLERANCE_MS = 500;
  const MAX_PULL_TICKS_RATIO = 0.05; // max 5% of tpSec pull

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  /**
   * Post a density sample from the active layer.
   * @param {number} absoluteSeconds - absolute ms
   * @param {string} layer - source layer
   * @param {number} density - normalized 0-1 note density in the recent window
   */
  function postDensity(absoluteSeconds, layer, density) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(layer, 'layer');
    const densityN = V.requireFinite(density, 'density');
    L0.post(DENSITY_CHANNEL, layer, absoluteSeconds, {
      density: clamp(densityN, 0, 1)
    });
  }

  /**
   * Measure current note density from ATW for the active layer.
   * @param {string} layer - layer to measure
   * @param {number} absTimeSec - current absolute seconds
   * @returns {number} normalized density 0-1
   */
  function measureDensity(layer, absTimeSec) {
    V.assertNonEmptyString(layer, 'layer');
    const at = V.requireFinite(absTimeSec, 'absTimeSec');
    const windowSec = DENSITY_WINDOW_MS / 1000;
    const count = L0.count('note', {
      layer,
      since: at - windowSec,
      windowSeconds: windowSec
    });
    // Normalize: 0 notes = 0, 10+ notes in 300ms = 1
    return clamp(count / 10, 0, 1);
  }

  /**
   * Compute a gravity-adjusted time offset for a note about to be placed.
   * Pulls the note toward a dense cluster in the other layer.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} originalTime - the time (seconds) where the note would normally go
   * @returns {number} adjusted time in seconds (may be shifted toward the gravity well)
   */
  function applyGravity(absoluteSeconds, activeLayer, originalTime) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const originalTimeN = V.requireFinite(originalTime, 'originalTime');

    // Find the nearest density peak from another layer
    const well = L0.findClosest(
      DENSITY_CHANNEL, absoluteSeconds, GRAVITY_TOLERANCE_MS / 1000, activeLayer
    );
    if (!well) return originalTimeN;
    V.assertObject(well, 'applyGravity.well');
    const wellDensity = V.requireFinite(well.density, 'applyGravity.well.density');
    const wellTimeSec = V.requireFinite(well.timeInSeconds, 'applyGravity.well.timeInSeconds');
    if (wellDensity < 0.3) return originalTimeN;

    // Pull strength proportional to density and proximity
    const wellTimeMs = wellTimeSec * 1000;
    const dist = m.abs(wellTimeMs - absoluteSeconds);
    const proximity = 1 - (dist / GRAVITY_TOLERANCE_MS);
    const melodicCtxTG = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const melodicGravityMult = melodicCtxTG
      ? (melodicCtxTG.contourShape === 'rising' ? 1.18 : melodicCtxTG.contourShape === 'falling' ? 0.80 : 1.0)
      * (melodicCtxTG.counterpoint === 'contrary' ? 0.70 : 1.0)
      * (1.0 + clamp(melodicCtxTG.thematicDensity, 0, 1) * 0.20)
      : 1.0;
    // R73: hotspots coupling -- rhythmically dense burst positions strengthen gravity wells.
    const rhythmEntryTG = L0.getLast('emergentRhythm', { layer: 'both' });
    const hotspotsScaleTG = rhythmEntryTG && Array.isArray(rhythmEntryTG.hotspots) ? rhythmEntryTG.hotspots.length / 16 : 0;
    const pullStrength = wellDensity * proximity * MAX_PULL_TICKS_RATIO * (0.5 + cimScale) * melodicGravityMult * (1.0 + hotspotsScaleTG * 0.30);

    // Direction: pull toward the gravity well's time position (seconds)
    const direction = wellTimeSec > originalTimeN ? 1 : -1;
    const maxPull = spBeat * pullStrength;
    const pull = m.min(maxPull, m.abs(wellTimeSec - originalTimeN) * 0.5);

    return originalTimeN + direction * pull;
  }

  return { postDensity, measureDensity, applyGravity, setCoordinationScale, reset() { /* stateless - no per-scope state to clear */ } };
})();
crossLayerRegistry.register('temporalGravity', temporalGravity, ['all']);
