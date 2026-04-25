// metaProfiles.js -- Metaprofile registry, loader, and accessor.
// Sets coordinated initial conditions for the relationship layer.
// Meta-controllers read their axis from the active metaprofile every tick.
//
// scaleFactor(axis, key) is the canonical multiplier API: it divides the
// active profile's value by the `default` profile's value, returning 1.0 when
// no profile is active or when the active profile lacks the key. Controllers
// multiply their _BASE constants by scaleFactor() instead of dividing by
// hardcoded baselines -- the implicit "default profile" lives in one place.

metaProfiles = (() => {
  const V = validator.create('metaProfiles');
  const _fs = require('fs');
  const _path = require('path');
  const _activeFile  = _path.join(METRICS_DIR, 'metaprofile-active.json');
  const _historyFile = _path.join(METRICS_DIR, 'metaprofile-history.jsonl');

  /** @type {Object|null} */
  let activeProfile = null;
  /** @type {string|null} */
  let activeProfileName = null;
  /** @type {number|null} */
  let activeSinceSection = null;

  // Default profile is the scaleFactor neutral point. Looked up once at module
  // load so accessors stay hot-path-cheap.
  const _defaultProfile = metaProfileDefinitions.get('default');
  if (!_defaultProfile) {
    throw new Error('metaProfiles: metaProfileDefinitions must define a "default" profile (scaleFactor neutral point)');
  }

  // Clear stale history at module load (once per pipeline run).
  if (_fs.existsSync(_historyFile)) _fs.unlinkSync(_historyFile);

  // Per-influence-point disable toggles. Set via METAPROFILE_DISABLE_AXES env
  // var (comma-separated) or programmatically. When disabled, accessors return
  // null for that axis -- controllers fall back to their own _BASE defaults.
  const _disabled = {};
  const _disableEnv = process.env.METAPROFILE_DISABLE_AXES;
  if (_disableEnv) {
    for (const axisId of _disableEnv.split(',').map(s => s.trim()).filter(Boolean)) {
      _disabled[axisId] = true;
    }
  }

  function _atomicWriteJson(file, obj) {
    const tmp = file + '.tmp';
    _fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    _fs.renameSync(tmp, file);
  }

  function _appendHistory(entry) {
    _fs.appendFileSync(_historyFile, JSON.stringify(entry) + '\n');
  }

  function setActive(name, currentSection) {
    if (name === null || name === undefined) {
      activeProfile = null;
      activeProfileName = null;
      activeSinceSection = null;
      if (_fs.existsSync(_activeFile)) _fs.unlinkSync(_activeFile);
      return true;
    }
    V.assertNonEmptyString(name, 'metaProfiles.setActive.name');
    const profile = metaProfileDefinitions.get(name);
    if (!profile) {
      throw new Error(`metaProfiles.setActive: unknown profile "${name}". Available: ${metaProfileDefinitions.list().join(', ')}`);
    }

    const sec = V.optionalFinite(currentSection, null);

    // Dwell guard: skip switch if active profile has not held its minimum
    // section span yet. Only applies when currentSection is provided AND we
    // already have an active profile AND the names differ.
    if (sec !== null && activeProfile !== null && activeProfileName !== name && activeSinceSection !== null) {
      const dwell = activeProfile.minDwellSections;
      const elapsed = sec - activeSinceSection;
      if (elapsed < dwell) return false;
    }

    activeProfile = profile;
    activeProfileName = name;
    activeSinceSection = sec;
    _atomicWriteJson(_activeFile, profile);
    _appendHistory({
      name,
      section: activeSinceSection,
      ts: Date.now(),
    });
    return true;
  }

  function getActive() { return activeProfile; }
  function getActiveName() { return activeProfileName; }
  function getActiveSinceSection() { return activeSinceSection; }
  function isActive() { return activeProfile !== null; }

  function getAxis(axis) {
    if (!activeProfile) return null;
    if (isAxisDisabled(axis)) return null;
    return activeProfile[axis] || null;
  }

  function getAxisValue(axis, key, fallback) {
    const section = getAxis(axis);
    if (!section || !(key in section)) return fallback;
    return section[key];
  }

  // scaleFactor(axis, key) = activeValue / defaultValue, or 1.0 when no
  // metaprofile is active / axis disabled / key missing. Controllers multiply
  // their _BASE constants by this -- the "default" profile is the single
  // source of truth for the scaling neutral point.
  function scaleFactor(axis, key) {
    const defAxis = /** @type {Record<string, any>} */ (_defaultProfile)[axis];
    if (!defAxis || !(key in defAxis)) {
      throw new Error(`metaProfiles.scaleFactor: default profile lacks "${axis}.${key}"`);
    }
    // Schema validation guarantees defAxis[key] is finite. The 0-divisor case
    // would only arise if a future axis legitimately defaults to 0; guard here.
    const defVal = defAxis[key];
    if (defVal === 0) {
      throw new Error(`metaProfiles.scaleFactor: default "${axis}.${key}" is 0 (no scaleFactor reference); use getAxisValue + additive bias instead`);
    }
    const active = getAxis(axis);
    if (!active || !(key in active)) return 1.0;
    return active[key] / defVal;
  }

  function disableAxis(axisId) { _disabled[axisId] = true; }
  function enableAxis(axisId)  { delete _disabled[axisId]; }
  function isAxisDisabled(axisId) { return Boolean(_disabled[axisId]); }

  // canSwitch(currentSection, candidateName) -- true when dwell allows a
  // switch to candidateName. Used by the section rotator before setActive.
  function canSwitch(currentSection, candidateName) {
    if (activeProfile === null || activeSinceSection === null) return true;
    if (activeProfileName === candidateName) return true;
    const sec = V.optionalFinite(currentSection, null);
    if (sec === null) return true;
    return (sec - activeSinceSection) >= activeProfile.minDwellSections;
  }

  // Convenience accessors. Return null when no profile active or axis
  // disabled, so callers can cleanly fall back to their own _BASE defaults
  // instead of using a duplicated baseline.
  function getRegimeTargets() {
    const r = getAxis('regime');
    return r ? { coherent: r.coherent, evolving: r.evolving, exploring: r.exploring } : null;
  }

  function getCouplingRange() {
    const c = getAxis('coupling');
    return c ? { lo: c.strength[0], hi: c.strength[1], density: c.density, antagonismThreshold: c.antagonismThreshold, midpoint: c.midpoint } : null;
  }

  function getTensionArc() {
    const t = getAxis('tension');
    return t ? { shape: t.shape, floor: t.floor, ceiling: t.ceiling } : null;
  }

  function getEnergyEnvelope() {
    const e = getAxis('energy');
    return e ? { densityTarget: e.densityTarget, flickerLo: e.flickerRange[0], flickerHi: e.flickerRange[1] } : null;
  }

  return {
    setActive,
    getActive,
    getActiveName,
    getActiveSinceSection,
    getAxis,
    getAxisValue,
    isActive,
    canSwitch,
    scaleFactor,
    getRegimeTargets,
    getCouplingRange,
    getTensionArc,
    getEnergyEnvelope,
    disableAxis,
    enableAxis,
    isAxisDisabled,
    list: metaProfileDefinitions.list,
    bySection: metaProfileDefinitions.bySection,
  };
})();
