grooveTransfer = (() => {
  const V = validator.create('grooveTransfer');
  const CHANNEL = 'grooveTransfer';
  const MAX_OFFSETS = 64;
  const DAMPING = 0.55;
  const LAYER_SET = new Set(['L1', 'L2']);

  /** @type {Map<string, number[]>} */
  const offsetsByLayer = new Map();
  /** @type {Map<string, number>} running sum per layer for O(1) average */
  const sumByLayer = new Map();

  /** @param {string} layer */
  function ensure(layer) {
    V.assertNonEmptyString(layer, 'layer');
    if (!offsetsByLayer.has(layer)) {
      offsetsByLayer.set(layer, []);
      sumByLayer.set(layer, 0);
    }
    const arr = offsetsByLayer.get(layer);
    if (!arr) throw new Error('grooveTransfer: failed to initialize layer offsets for ' + layer);
    return arr;
  }

  function getAbsoluteTimeGridOrThrow() {
    V.assertObject(absoluteTimeGrid, 'absoluteTimeGrid');
    return absoluteTimeGrid;
  }

  /**
   * @param {number} tick
   * @returns {number}
   */
  function getAbsoluteTimeMs(tick) {
    const msTick = V.requireFinite(tick, 'tick');
    const currentMeasureStart = V.requireFinite(measureStart, 'measureStart');
    const currentMeasureStartTime = V.requireFinite(measureStartTime, 'measureStartTime');
    const currentTpSec = V.requireFinite(tpSec, 'tpSec');
    return (currentMeasureStartTime + (msTick - currentMeasureStart) / currentTpSec) * 1000;
  }

  /** @param {'beat'|'div'|'subdiv'|'subsubdiv'|string} unit */
  function getUnitStart(unit) {
    V.assertNonEmptyString(unit, 'unit');
    if (unit === 'beat') return V.requireFinite(beatStart, 'beatStart');
    if (unit === 'div') return V.requireFinite(divStart, 'divStart');
    if (unit === 'subdiv') return V.requireFinite(subdivStart, 'subdivStart');
    if (unit === 'subsubdiv') return V.requireFinite(subsubdivStart, 'subsubdivStart');
    return V.requireFinite(beatStart, 'beatStart');
  }

  /**
   * @param {string} layer
   * @param {number} tick
   * @param {string} unit
   */
  function recordTiming(layer, tick, unit) {
    V.assertNonEmptyString(layer, 'recordTiming.layer');
    const tickN = V.requireFinite(tick, 'recordTiming.tick');
    V.assertNonEmptyString(unit, 'recordTiming.unit');
    const base = getUnitStart(unit);
    const offset = tickN - base;
    const row = ensure(layer);
    row.push(offset);
    sumByLayer.set(layer, (sumByLayer.get(layer) || 0) + offset);
    if (row.length > MAX_OFFSETS) {
      sumByLayer.set(layer, (sumByLayer.get(layer) || 0) - row[0]);
      row.shift();
    }

    const absMs = getAbsoluteTimeMs(tickN);
    const atg = getAbsoluteTimeGridOrThrow();
    atg.post(CHANNEL, layer, absMs, { offset, unit });
  }

  /**
   * @param {string} layer
   * @param {number} tick
   * @param {string} unit
   */
  function applyOffset(layer, tick, unit) {
    V.assertInSet(layer, LAYER_SET, 'applyOffset.layer');
    const tickN = V.requireFinite(tick, 'applyOffset.tick');
    V.assertNonEmptyString(unit, 'applyOffset.unit');

    const otherLayer = layer === 'L1' ? 'L2' : 'L1';
    const other = ensure(otherLayer);
    if (other.length === 0) return tickN;

    const avg = (sumByLayer.get(otherLayer) || 0) / other.length;

    const absMs = getAbsoluteTimeMs(tickN);
    const atg = getAbsoluteTimeGridOrThrow();

    let localTransfer = avg;
    const closest = atg.findClosest(CHANNEL, absMs, 120, layer);
    if (closest) {
      V.assertObject(closest, 'applyOffset.closest');
      const closestOffset = V.requireFinite(closest.offset, 'applyOffset.closest.offset');
      const closestUnit = V.assertNonEmptyString(closest.unit, 'applyOffset.closest.unit');
      if (closestUnit === unit) {
        localTransfer = (avg * 0.5) + (closestOffset * 0.5);
      }
    }

    const shifted = tickN + localTransfer * DAMPING;
    return m.round(shifted);
  }

  function reset() {
    offsetsByLayer.clear();
    sumByLayer.clear();
  }

  return { recordTiming, applyOffset, reset };
})();
crossLayerRegistry.register('grooveTransfer', grooveTransfer, ['all', 'phrase']);
