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

  /** @param {'beat'|'div'|'subdiv'|'subsubdiv'|string} unit */
  function getUnitStartTime(unit) {
    V.assertNonEmptyString(unit, 'unit');
    if (unit === 'beat') return V.requireFinite(beatStartTime, 'beatStartTime');
    if (unit === 'div') return V.requireFinite(divStartTime, 'divStartTime');
    if (unit === 'subdiv') return V.requireFinite(subdivStartTime, 'subdivStartTime');
    if (unit === 'subsubdiv') return V.requireFinite(subsubdivStartTime, 'subsubdivStartTime');
    return V.requireFinite(beatStartTime, 'beatStartTime');
  }

  /**
   * @param {string} layer
   * @param {number} timeSec - onset time in seconds
   * @param {string} unit
   */
  function recordTiming(layer, timeSec, unit) {
    V.assertNonEmptyString(layer, 'recordTiming.layer');
    const timeInSeconds = V.requireFinite(timeSec, 'recordTiming.timeSec');
    V.assertNonEmptyString(unit, 'recordTiming.unit');
    const base = getUnitStartTime(unit);
    const offset = timeInSeconds - base;
    const row = ensure(layer);
    row.push(offset);
    sumByLayer.set(layer, (sumByLayer.get(layer) || 0) + offset);
    if (row.length > MAX_OFFSETS) {
      sumByLayer.set(layer, (sumByLayer.get(layer) || 0) - row[0]);
      row.shift();
    }

    L0.post(CHANNEL, layer, timeInSeconds, { offset, unit });
  }

  /**
   * @param {string} layer
   * @param {number} timeSec - onset time in seconds
   * @param {string} unit
   */
  function applyOffset(layer, timeSec, unit) {
    V.assertInSet(layer, LAYER_SET, 'applyOffset.layer');
    const timeInSeconds = V.requireFinite(timeSec, 'applyOffset.timeSec');
    V.assertNonEmptyString(unit, 'applyOffset.unit');

    const otherLayer = crossLayerHelpers.getOtherLayer(layer);
    const other = ensure(otherLayer);
    if (other.length === 0) return timeInSeconds;

    const avg = (sumByLayer.get(otherLayer) || 0) / other.length;

    let localTransfer = avg;
    const closest = L0.findClosest(CHANNEL, timeInSeconds, 0.120, layer);
    if (closest) {
      V.assertObject(closest, 'applyOffset.closest');
      const closestOffset = V.requireFinite(closest.offset, 'applyOffset.closest.offset');
      const closestUnit = V.assertNonEmptyString(closest.unit, 'applyOffset.closest.unit');
      if (closestUnit === unit) {
        localTransfer = (avg * 0.5) + (closestOffset * 0.5);
      }
    }

    return timeInSeconds + localTransfer * DAMPING;
  }

  function reset() {
    offsetsByLayer.clear();
    sumByLayer.clear();
  }

  return { recordTiming, applyOffset, reset };
})();
crossLayerRegistry.register('grooveTransfer', grooveTransfer, ['all', 'phrase']);
