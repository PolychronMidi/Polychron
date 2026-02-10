// MotifUnit.js - helper to resolve tick values for motif duration units

MotifUnit = {
  /**
   * Convert a duration unit string to its global tick value (tpMeasure, tpBeat, ...).
   * Throws on invalid/undefined global timing values.
   * @param {string} unit
   * @returns {number}
   */
  unitTicks(unit) {
    let value;
    switch ((unit || '').toLowerCase()) {
      case 'measure': value = tpMeasure; break;
      case 'beat': value = tpBeat; break;
      case 'div': value = tpDiv; break;
      case 'subdiv': value = tpSubdiv; break;
      case 'subsubdiv': value = tpSubsubdiv; break;
      default: value = tpSubdiv;
    }
    if (!Number.isFinite(Number(value))) {
      throw new Error(`MotifUnit.unitTicks: invalid or undefined tick value for unit "${unit}"`);
    }
    return Number(value);
  }
};
