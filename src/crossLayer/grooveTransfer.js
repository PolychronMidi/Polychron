GrooveTransfer = (() => {
  const CHANNEL = 'grooveTransfer';
  const MAX_OFFSETS = 64;
  const DAMPING = 0.55;

  /** @type {Map<string, number[]>} */
  const offsetsByLayer = new Map();

  /** @param {string} layer */
  function ensure(layer) {
    if (!offsetsByLayer.has(layer)) offsetsByLayer.set(layer, []);
    const arr = offsetsByLayer.get(layer);
    if (!arr) throw new Error('GrooveTransfer: failed to initialize layer offsets for ' + layer);
    return arr;
  }

  /** @param {'beat'|'div'|'subdiv'|'subsubdiv'|string} unit */
  function getUnitStart(unit) {
    if (unit === 'beat' && Number.isFinite(beatStart)) return beatStart;
    if (unit === 'div' && Number.isFinite(divStart)) return divStart;
    if (unit === 'subdiv' && Number.isFinite(subdivStart)) return subdivStart;
    if (unit === 'subsubdiv' && Number.isFinite(subsubdivStart)) return subsubdivStart;
    if (Number.isFinite(beatStart)) return beatStart;
    return 0;
  }

  /**
   * @param {string} layer
   * @param {number} tick
   * @param {string} unit
   */
  function recordTiming(layer, tick, unit) {
    if (!Number.isFinite(tick)) throw new Error('GrooveTransfer.recordTiming: tick must be finite');
    const base = getUnitStart(unit);
    const offset = tick - base;
    const row = ensure(layer);
    row.push(offset);
    if (row.length > MAX_OFFSETS) row.shift();

    const absMs = Number.isFinite(measureStart) && Number.isFinite(measureStartTime) && Number.isFinite(tpSec)
      ? (measureStartTime + (tick - measureStart) / tpSec) * 1000
      : (Number.isFinite(beatStartTime) ? beatStartTime * 1000 : 0);

    if (typeof AbsoluteTimeGrid !== 'undefined' && AbsoluteTimeGrid && typeof AbsoluteTimeGrid.post === 'function') {
      AbsoluteTimeGrid.post(CHANNEL, layer, absMs, { offset, unit });
    }
  }

  /**
   * @param {string} layer
   * @param {number} tick
   * @param {string} unit
   */
  function applyOffset(layer, tick, unit) {
    if (!Number.isFinite(tick)) throw new Error('GrooveTransfer.applyOffset: tick must be finite');
    const otherLayer = layer === 'L1' ? 'L2' : 'L1';
    const other = ensure(otherLayer);
    if (other.length === 0) return tick;

    const avg = other.reduce((sum, v) => sum + v, 0) / other.length;

    const absMs = Number.isFinite(measureStart) && Number.isFinite(measureStartTime) && Number.isFinite(tpSec)
      ? (measureStartTime + (tick - measureStart) / tpSec) * 1000
      : (Number.isFinite(beatStartTime) ? beatStartTime * 1000 : 0);

    let localTransfer = avg;
    const closest = (typeof AbsoluteTimeGrid !== 'undefined' && AbsoluteTimeGrid && typeof AbsoluteTimeGrid.findClosest === 'function')
      ? AbsoluteTimeGrid.findClosest(CHANNEL, absMs, 120, layer)
      : null;
    if (closest && Number.isFinite(closest.offset) && closest.unit === unit) {
      localTransfer = (avg * 0.5) + (closest.offset * 0.5);
    }

    const shifted = tick + localTransfer * DAMPING;
    return Math.round(shifted);
  }

  function reset() {
    offsetsByLayer.clear();
  }

  return { recordTiming, applyOffset, reset };
})();
