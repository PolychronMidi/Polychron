// ModuleLifecycle.js — Shared scope-based lifecycle management.
// Both CrossLayerRegistry and ConductorIntelligence compose this
// for uniform module lifecycle (scoped resets at all/section/phrase boundaries).
// Each module self-declares which scopes it participates in at registration time.

ModuleLifecycle = (() => {
  const V = Validator.create('ModuleLifecycle');

  /**
   * Create a new lifecycle instance for a subsystem.
   * @param {string} ownerName — diagnostic label (e.g. 'CrossLayerRegistry')
   * @returns {{ register, resetByScope, resetAll, resetSection, resetPhrase, getNames, getCount }}
   */
  function create(ownerName) {
    /** @type {Array<{ name: string, module: { reset: function }, scopes: Set<string> }>} */
    const entries = [];
    /** @type {Set<string>} */
    const registered = new Set();

    /**
     * Register a module for scoped lifecycle resets.
     * @param {string} name — unique module name
     * @param {{ reset: function }} mod — must expose reset()
     * @param {Array<'all'|'section'|'phrase'>} scopes — which resets to participate in
     */
    function register(name, mod, scopes) {
      V.assertNonEmptyString(name, 'name');
      if (!mod || typeof mod.reset !== 'function') {
        throw new Error(`${ownerName}.registerModule: "${name}" must expose reset()`);
      }
      if (!Array.isArray(scopes) || scopes.length === 0) {
        throw new Error(`${ownerName}.registerModule: "${name}" must declare at least one scope`);
      }
      if (registered.has(name)) {
        throw new Error(`${ownerName}.registerModule: duplicate "${name}"`);
      }
      registered.add(name);
      entries.push({ name, module: mod, scopes: new Set(scopes) });
    }

    /** Reset all modules that opted into the given scope. */
    function resetByScope(scope) {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].scopes.has(scope)) entries[i].module.reset();
      }
    }

    function resetAll() { resetByScope('all'); }
    function resetSection() { resetByScope('section'); }
    function resetPhrase() { resetByScope('phrase'); }

    /** @returns {string[]} */
    function getNames() { return entries.map(e => e.name); }
    /** @returns {number} */
    function getCount() { return entries.length; }

    return { register, resetByScope, resetAll, resetSection, resetPhrase, getNames, getCount };
  }

  return { create };
})();
