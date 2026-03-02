// moduleLifecycle.js - Shared scope-based lifecycle management.
// Both crossLayerRegistry and conductorIntelligence compose this
// for uniform module lifecycle (scoped resets at all/section/phrase boundaries).
// Each module self-declares which scopes it participates in at registration time.

moduleLifecycle = (() => {
  const V = validator.create('moduleLifecycle');

  /**
   * Create a new lifecycle instance for a subsystem.
   * @param {string} ownerName - diagnostic label (e.g. 'crossLayerRegistry')
   * @returns {{ register, resetByScope, resetAll, resetSection, resetPhrase, getNames, getCount }}
   */
  function create(ownerName) {
    /** @type {Array<{ name: string, module: { reset: function }, scopes: Set<string> }>} */
    const entries = [];
    /** @type {Set<string>} */
    const registered = new Set();

    /**
     * Register a module for scoped lifecycle resets.
     * @param {string} name - unique module name
     * @param {{ reset: function }} mod - must expose reset()
     * @param {Array<'all'|'section'|'phrase'>} scopes - which resets to participate in
     */
    function register(name, mod, scopes) {
      V.assertNonEmptyString(name, 'name');
      V.assertObject(mod, 'mod');
      V.requireType(mod.reset, 'function', 'mod.reset');
      V.assertArray(scopes, 'scopes');
      if (scopes.length === 0) {
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

  // --- Global Initialization Registry ---
  const initializers = new Map();

  /**
   * Register a module for automatic initialization during boot.
   * @param {string} name - unique module name
   * @param {function} initFn - initialization function
   * @param {string[]} [dependencies] - names of modules that must initialize before this one
   */
  function registerInitializer(name, initFn, dependencies = []) {
    V.assertNonEmptyString(name, 'registerInitializer.name');
    V.requireType(initFn, 'function', 'initFn');
    if (initializers.has(name)) {
      throw new Error(`moduleLifecycle.registerInitializer: duplicate "${name}"`);
    }
    initializers.set(name, { name, initFn, dependencies });
  }

  /**
   * Execute all registered initializers in topological order.
   * Throws on circular dependencies or missing dependencies.
   */
  function initializeAll() {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();

    function visit(name) {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`moduleLifecycle.initializeAll: Circular dependency detected involving "${name}"`);
      }
      visiting.add(name);

      const entry = initializers.get(name);
      if (!entry) {
        throw new Error(`moduleLifecycle.initializeAll: Missing dependency "${name}"`);
      }

      for (const dep of entry.dependencies) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(entry);
    }

    for (const name of initializers.keys()) {
      visit(name);
    }

    for (const entry of sorted) {
      entry.initFn();
    }
  }

  return { create, registerInitializer, initializeAll };
})();
