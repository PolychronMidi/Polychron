// src/crossLayer/CrossLayerRegistry.js — Self-registration hub for cross-layer modules.
// Each module registers itself with reset scopes ('all', 'section', 'phrase').
// CrossLayerLifecycleManager iterates this registry instead of probing typeof guards.

CrossLayerRegistry = (() => {
  /**
   * @typedef {{
   *   name: string,
   *   module: { reset: function },
   *   scopes: Set<'all'|'section'|'phrase'>
   * }} RegistryEntry
   */

  /** @type {RegistryEntry[]} */
  const entries = [];

  /** @type {Set<string>} */
  const registered = new Set();

  /**
   * Register a cross-layer module for lifecycle management.
   * @param {string} name — unique module name (used for diagnostics)
   * @param {{ reset: function }} mod — module object with a reset() method
   * @param {Array<'all'|'section'|'phrase'>} scopes — which resets to participate in
   */
  function register(name, mod, scopes) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('CrossLayerRegistry.register: name must be a non-empty string');
    }
    if (!mod || typeof mod.reset !== 'function') {
      throw new Error('CrossLayerRegistry.register: module "' + name + '" must expose a reset() method');
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new Error('CrossLayerRegistry.register: module "' + name + '" must declare at least one reset scope');
    }
    if (registered.has(name)) {
      throw new Error('CrossLayerRegistry.register: duplicate registration for "' + name + '"');
    }
    registered.add(name);
    entries.push({ name, module: mod, scopes: new Set(scopes) });
  }

  /** Reset all registered modules that opted into the 'all' scope. */
  function resetAll() {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].scopes.has('all')) entries[i].module.reset();
    }
  }

  /** Reset registered modules that opted into the 'section' scope. */
  function resetSection() {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].scopes.has('section')) entries[i].module.reset();
    }
  }

  /** Reset registered modules that opted into the 'phrase' scope. */
  function resetPhrase() {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].scopes.has('phrase')) entries[i].module.reset();
    }
  }

  /** @returns {string[]} names of all registered modules */
  function getRegisteredNames() {
    return entries.map(e => e.name);
  }

  /** @returns {number} count of registered modules */
  function getCount() {
    return entries.length;
  }

  return { register, resetAll, resetSection, resetPhrase, getRegisteredNames, getCount };
})();
