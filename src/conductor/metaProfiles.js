// metaProfiles.js — Metaprofile registry, loader, and accessor.
// Sets coordinated initial conditions for the relationship layer.
// Meta-controllers read their axis from the active metaprofile at boot.

metaProfiles = (() => {
  const V = validator.create('metaProfiles');

  /** @type {Object|null} */
  let activeProfile = null;

  /** @type {string|null} */
  let activeProfileName = null;

  function setActive(name) {
    if (name === null || name === undefined) {
      activeProfile = null;
      activeProfileName = null;
      return;
    }
    V.assertNonEmptyString(name, 'metaProfiles.setActive.name');
    const profile = metaProfileDefinitions.get(name);
    if (!profile) {
      throw new Error(`metaProfiles.setActive: unknown profile "${name}". Available: ${metaProfileDefinitions.list().join(', ')}`);
    }
    activeProfile = profile;
    activeProfileName = name;
    // Persist to metrics/ so HME Python tools can read the active profile
    try {
      const _fs = require('fs');
      const _path = require('path');
      const _out = _path.join(process.cwd(), 'metrics', 'metaprofile-active.json');
      _fs.writeFileSync(_out, JSON.stringify(profile, null, 2));
    } catch (_e) { /* non-fatal */ }
  }

  function getActive() {
    return activeProfile;
  }

  function getActiveName() {
    return activeProfileName;
  }

  function getAxis(axis) {
    if (!activeProfile) return null;
    return activeProfile[axis] || null;
  }

  function getAxisValue(axis, key, fallback) {
    const section = getAxis(axis);
    if (!section || !(key in section)) return fallback;
    return section[key];
  }

  function isActive() {
    return activeProfile !== null;
  }

  // Convenience: regime targets with built-in defaults (equal distribution)
  function getRegimeTargets() {
    const regime = getAxis('regime');
    return {
      coherent:  regime ? regime.coherent  : 0.333,
      evolving:  regime ? regime.evolving  : 0.333,
      exploring: regime ? regime.exploring : 0.333,
    };
  }

  // Convenience: coupling range with defaults
  function getCouplingRange() {
    return {
      lo: getAxisValue('coupling', 'strength', [0.3, 0.7])[0],
      hi: getAxisValue('coupling', 'strength', [0.3, 0.7])[1],
      density: getAxisValue('coupling', 'density', 0.25),
      antagonismThreshold: getAxisValue('coupling', 'antagonismThreshold', -0.25),
    };
  }

  // Convenience: tension arc with defaults
  function getTensionArc() {
    return {
      shape: getAxisValue('tension', 'shape', 'arch'),
      floor: getAxisValue('tension', 'floor', 0.20),
      ceiling: getAxisValue('tension', 'ceiling', 0.80),
    };
  }

  // Convenience: energy envelope with defaults
  function getEnergyEnvelope() {
    return {
      densityTarget: getAxisValue('energy', 'densityTarget', 0.50),
      flickerLo: getAxisValue('energy', 'flickerRange', [0.04, 0.15])[0],
      flickerHi: getAxisValue('energy', 'flickerRange', [0.04, 0.15])[1],
    };
  }

  return {
    setActive,
    getActive,
    getActiveName,
    getAxis,
    getAxisValue,
    isActive,
    getRegimeTargets,
    getCouplingRange,
    getTensionArc,
    getEnergyEnvelope,
    list: metaProfileDefinitions.list,
  };
})();
