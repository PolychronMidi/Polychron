// motifConfig.js - named motif profiles + per-unit hierarchical profiles
// Delegates authoritative profiles to src/conductor/config.js, adds unit-level controls
// for hierarchical motif spreading (group sizing, intervalComposer density/style).

motifConfig = (function() {
  const UNIT_PROFILES = MOTIF_UNIT_PROFILES;

  // Dynamic overrides store (cleared on section boundary if needed, but Conductor manages it)
  const OVERRIDES = {};

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('motifConfig.getProfile: invalid name');
    const source = MOTIF_PROFILES;
    const p = source[name];
    if (!p) throw new Error(`motifConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  function getUnitProfile(unit) {
    if (!unit || typeof unit !== 'string') throw new Error('motifConfig.getUnitProfile: invalid unit');
    const base = UNIT_PROFILES[unit];
    if (!base) throw new Error(`motifConfig.getUnitProfile: unknown unit "${unit}"`);
    const override = OVERRIDES[unit] || {};
    return Object.assign({}, base, override);
  }

  /**
   * Set runtime overrides for a unit profile (e.g. modulate density)
   * @param {string} unit - 'measure'|'beat'|'div'|'subdiv'|'subsubdiv'
   * @param {Object} props - properties to override (e.g. { intervalDensity: 0.8 })
   */
  function setUnitProfileOverride(unit, props) {
    if (!unit || !UNIT_PROFILES[unit]) return;
    OVERRIDES[unit] = Object.assign({}, OVERRIDES[unit] || {}, props);
  }

  return { getProfile, getUnitProfile, setUnitProfileOverride };
})();
