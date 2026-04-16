// metaProfiles.js -- Metaprofile registry, loader, and accessor.
// Sets coordinated initial conditions for the relationship layer.
// Meta-controllers read their axis from the active metaprofile at boot.

metaProfiles = (() => {
  const V = validator.create('metaProfiles');

  /** @type {Object|null} */
  let activeProfile = null;

  /** @type {string|null} */
  let activeProfileName = null;

  function setActive(name) {
    const _fs = require('fs');
    const _path = require('path');
    const _out = _path.join(process.cwd(), 'metrics', 'metaprofile-active.json');
    if (name === null || name === undefined) {
      activeProfile = null;
      activeProfileName = null;
      if (_fs.existsSync(_out)) _fs.unlinkSync(_out);
      // Explicit no-op return: null/undefined = clear active profile, no further setup needed.
      return;  // eslint-disable-line local/no-silent-early-return
    }
    V.assertNonEmptyString(name, 'metaProfiles.setActive.name');
    const profile = metaProfileDefinitions.get(name);
    if (!profile) {
      throw new Error(`metaProfiles.setActive: unknown profile "${name}". Available: ${metaProfileDefinitions.list().join(', ')}`);
    }
    activeProfile = profile;
    activeProfileName = name;
    // Persist to metrics/ so HME Python tools can read the active profile
    _fs.writeFileSync(_out, JSON.stringify(profile, null, 2));
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

  // Per-influence-point disable toggles. Set to true to suppress specific axes
  // while keeping the rest of the metaprofile active. For debugging "which axis
  // caused this behavioral change?"
  const _disabled = {};

  function disableAxis(axisId) {
    _disabled[axisId] = true;
  }

  function enableAxis(axisId) {
    delete _disabled[axisId];
  }

  function isAxisDisabled(axisId) {
    return Boolean(_disabled[axisId]);
  }

  function isActive() {
    return activeProfile !== null;
  }

  // Convenience accessors -- each checks isAxisDisabled() and returns defaults when suppressed.
  function getRegimeTargets() {
    if (isAxisDisabled('regime-budget')) return { coherent: 0.333, evolving: 0.333, exploring: 0.333 };
    const regime = getAxis('regime');
    return {
      coherent:  regime ? regime.coherent  : 0.333,
      evolving:  regime ? regime.evolving  : 0.333,
      exploring: regime ? regime.exploring : 0.333,
    };
  }

  function getCouplingRange() {
    if (isAxisDisabled('coupling-ceiling-scale')) return { lo: 0.3, hi: 0.7, density: 0.25, antagonismThreshold: -0.25 };
    return {
      lo: getAxisValue('coupling', 'strength', [0.3, 0.7])[0],
      hi: getAxisValue('coupling', 'strength', [0.3, 0.7])[1],
      density: getAxisValue('coupling', 'density', 0.25),
      antagonismThreshold: getAxisValue('coupling', 'antagonismThreshold', -0.25),
    };
  }

  function getTensionArc() {
    if (isAxisDisabled('tension-amplitude') && isAxisDisabled('tension-shape')) return { shape: 'arch', floor: 0.20, ceiling: 0.80 };
    return {
      shape: isAxisDisabled('tension-shape') ? 'arch' : getAxisValue('tension', 'shape', 'arch'),
      floor: getAxisValue('tension', 'floor', 0.20),
      ceiling: isAxisDisabled('tension-amplitude') ? 0.80 : getAxisValue('tension', 'ceiling', 0.80),
    };
  }

  function getEnergyEnvelope() {
    if (isAxisDisabled('density-amplitude')) return { densityTarget: 0.50, flickerLo: 0.04, flickerHi: 0.15 };
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
    disableAxis,
    enableAxis,
    isAxisDisabled,
    list: metaProfileDefinitions.list,
  };
})();
