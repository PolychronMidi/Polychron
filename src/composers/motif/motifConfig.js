// motifConfig.js - named motif profiles + per-unit hierarchical profiles
// Delegates authoritative profiles to src/config.js, adds unit-level controls
// for hierarchical motif spreading (group sizing, IntervalComposer density/style).

motifConfig = (function() {
  const LOCAL = {
    default: { velocityScale: 1, timingOffset: 0 },
    sparse: { velocityScale: 0.8, timingOffset: 0.1 },
    dense: { velocityScale: 1.2, timingOffset: -0.05 }
  };

  // Per-unit hierarchical profiles control IntervalComposer density/style and
  // motifModulator velocity scaling at each level of the hierarchy.
  const UNIT_PROFILES = {
    measure:    { density: 0.7, style: 'random', intervalDensity: 0.7, velocityScale: 1.0 },
    beat:       { density: 0.6, style: 'random', intervalDensity: 0.6, velocityScale: 0.95 },
    div:        { density: 0.5, style: 'random', intervalDensity: 0.5, velocityScale: 0.9 },
    subdiv:     { density: 0.4, style: 'random', intervalDensity: 0.4, velocityScale: 0.85 },
    subsubdiv:  { density: 0.3, style: 'random', intervalDensity: 0.3, velocityScale: 0.8 }
  };

  // Dynamic overrides store (cleared on section boundary if needed, but Conductor manages it)
  const OVERRIDES = {};

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('motifConfig.getProfile: invalid name');
    const source = (typeof MOTIF_PROFILES !== 'undefined' && MOTIF_PROFILES) ? MOTIF_PROFILES : (console.warn('Acceptable warning: motifConfig: using local defaults. For project-wide settings, define MOTIF_PROFILES in src/config.js.'), LOCAL);
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
