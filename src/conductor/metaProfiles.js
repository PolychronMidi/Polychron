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

  return {
    setActive,
    getActive,
    getActiveName,
    getAxis,
    getAxisValue,
    isActive,
    list: metaProfileDefinitions.list,
  };
})();
