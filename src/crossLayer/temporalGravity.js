// src/crossLayer/temporalGravity.js — Temporal gravity wells.
// Posts note density per ms window to ATG 'density' channel. When one layer
// hits a dense cluster, the other layer's note ticks get micro-pulled toward
// the cluster center — creating organic emergent rubato.

TemporalGravity = (() => {
  const V = Validator.create('TemporalGravity');
  const DENSITY_CHANNEL = 'density';
  const DENSITY_WINDOW_MS = 300;
  const GRAVITY_TOLERANCE_MS = 500;
  const MAX_PULL_TICKS_RATIO = 0.05; // max 5% of tpSec pull

  /**
   * Post a density sample from the active layer.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} density - normalized 0-1 note density in the recent window
   */
  function postDensity(absTimeMs, layer, density) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    AbsoluteTimeGrid.post(DENSITY_CHANNEL, layer, absTimeMs, {
      density: clamp(density, 0, 1)
    });
  }

  /**
   * Measure current note density from ATW for the active layer.
   * @param {string} layer - layer to measure
   * @param {number} absTimeSec - current absolute seconds
   * @returns {number} normalized density 0-1
   */
  function measureDensity(layer, absTimeSec) {
    const windowSec = DENSITY_WINDOW_MS / 1000;
    const notes = AbsoluteTimeWindow.getNotes({
      layer,
      since: absTimeSec - windowSec,
      windowSeconds: windowSec
    });
    // Normalize: 0 notes = 0, 10+ notes in 300ms = 1
    return clamp(notes.length / 10, 0, 1);
  }

  /**
   * Compute a gravity-adjusted tick offset for a note about to be placed.
   * Pulls the note toward a dense cluster in the other layer.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} originalTick - the tick where the note would normally go
   * @returns {number} adjusted tick (may be shifted toward the gravity well)
   */
  function applyGravity(absTimeMs, activeLayer, originalTick) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(originalTick, 'originalTick');

    // Find the nearest density peak from another layer
    const well = AbsoluteTimeGrid.findClosest(
      DENSITY_CHANNEL, absTimeMs, GRAVITY_TOLERANCE_MS, activeLayer
    );
    if (!well || !Number.isFinite(well.density) || well.density < 0.3) return originalTick;

    // Pull strength proportional to density and proximity
    const dist = Math.abs(well.timeMs - absTimeMs);
    const proximity = 1 - (dist / GRAVITY_TOLERANCE_MS);
    const pullStrength = well.density * proximity * MAX_PULL_TICKS_RATIO;

    // Direction: pull toward the gravity well's ms in tick space
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const wellTick = Math.round(measureStart + ((well.timeMs / 1000) - measureStartTime) * tpSec);
    const direction = wellTick > originalTick ? 1 : -1;
    const maxPull = tpSec * pullStrength;
    const pull = Math.min(maxPull, Math.abs(wellTick - originalTick) * 0.5);

    return Math.round(originalTick + direction * pull);
  }

  return { postDensity, measureDensity, applyGravity };
})();
