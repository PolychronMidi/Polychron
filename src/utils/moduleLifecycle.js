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

  // ===================================================================
  // STEPPING-STONE DI REGISTRY (phase 1 foundation)
  // ===================================================================
  // Full DI is a multi-week refactor; this is the scaffolding that gets
  // ~75% of DI's benefits and makes the eventual full DI a mechanical
  // sweep rather than a redesign. Five non-negotiable design choices:
  //
  // 1. `deps` is non-optional in the manifest. Without it, no topo-sort,
  //    no safePreBoot elimination, no firewall enforcement.
  // 2. Registry owns the global assignment. Modules `init(deps)` and
  //    return their API; the registry binds the return value to the
  //    global named in `provides`. Inverts today's `name = (() => {...})()`
  //    pattern -- that's what lets full DI later be a mechanical sweep.
  // 3. `init(deps)` lifecycle replaces IIFE-at-require-time. Kills the
  //    171+ safePreBoot.call() defensive guards because deps are
  //    GUARANTEED resolved before init() runs.
  // 4. Boot order derived from manifests via topo-sort, never maintained
  //    by hand. Adding a module = drop a file with declare(); nothing
  //    else changes.
  // 5. Test-mode override API: registry.override(name, mock) before
  //    initializeAll() lets tests swap any module without touching
  //    the global namespace. Captures DI's testability win.
  //
  // Coexists with legacy IIFE+globals during migration. A declared
  // module CAN list legacy globals as deps -- the registry resolves
  // them via globalThis at init time. Strictness comes later when
  // every module is migrated.
  //
  // Manifest schema:
  //   {
  //     name:       string                       -- unique identifier
  //     deps:       string[]                     -- depended-on modules (declared or legacy)
  //     provides:   string[]                     -- global names the init return is bound to
  //     init:       (deps: object) => any        -- returns the module API
  //     subsystem?: string                       -- 'utils'|'conductor'|'rhythm'|... (firewall metadata)
  //     reads?:     string[]                     -- cross-subsystem reads (firewall metadata)
  //     emits?:     string[]                     -- L0 channels written (firewall metadata)
  //   }
  //
  // The optional metadata (subsystem/reads/emits) is consumed by the
  // future verifier; the registry itself only needs name/deps/provides/init.
  // ===================================================================

  /** @type {Map<string, object>} */
  const _manifests = new Map();
  /** @type {Map<string, any>} */
  const _instances = new Map();
  /** @type {Map<string, any>} */
  const _overrides = new Map();
  let _bootState = 'pending'; // 'pending' | 'booting' | 'booted'

  function _validateManifest(m) {
    V.assertPlainObject(m, 'declare.manifest');
    V.assertNonEmptyString(m.name, 'declare.manifest.name');
    V.assertArray(m.deps, `declare.manifest.deps for "${m.name}"`);
    V.assertArray(m.provides, `declare.manifest.provides for "${m.name}"`);
    if (m.provides.length === 0) {
      throw new Error(`moduleLifecycle.declare: "${m.name}" provides must list at least one global name (typically [name] itself)`);
    }
    V.requireType(m.init, 'function', `declare.manifest.init for "${m.name}"`);
    for (let i = 0; i < m.deps.length; i++) {
      V.assertNonEmptyString(m.deps[i], `declare.manifest.deps[${i}] for "${m.name}"`);
    }
    for (let i = 0; i < m.provides.length; i++) {
      V.assertNonEmptyString(m.provides[i], `declare.manifest.provides[${i}] for "${m.name}"`);
    }
    if (m.subsystem !== undefined) V.assertNonEmptyString(m.subsystem, `declare.manifest.subsystem for "${m.name}"`);
    if (m.reads !== undefined) {
      V.assertArray(m.reads, `declare.manifest.reads for "${m.name}"`);
      for (let i = 0; i < m.reads.length; i++) V.assertNonEmptyString(m.reads[i], `declare.manifest.reads[${i}]`);
    }
    if (m.emits !== undefined) {
      V.assertArray(m.emits, `declare.manifest.emits for "${m.name}"`);
      for (let i = 0; i < m.emits.length; i++) V.assertNonEmptyString(m.emits[i], `declare.manifest.emits[${i}]`);
    }
  }

  /**
   * Declare a module manifest. The init() function will be called with
   * resolved dependencies during initializeAll(); its return value is
   * bound to globalThis under each name in `provides`.
   */
  function declare(manifest) {
    _validateManifest(manifest);
    if (_bootState === 'booted') {
      throw new Error(`moduleLifecycle.declare: cannot declare "${manifest.name}" after boot completed`);
    }
    if (_manifests.has(manifest.name)) {
      throw new Error(`moduleLifecycle.declare: duplicate manifest for "${manifest.name}"`);
    }
    if (initializers.has(manifest.name)) {
      throw new Error(`moduleLifecycle.declare: "${manifest.name}" already registered via registerInitializer; use one or the other, not both`);
    }
    _manifests.set(manifest.name, manifest);
  }

  /**
   * Override a module instance for testing. Must be called BEFORE
   * initializeAll(). The override's identity becomes the resolved
   * instance during boot (init() is NOT called for overridden modules).
   * The value is also bound to globalThis under each `provides` name.
   */
  function override(name, instance) {
    V.assertNonEmptyString(name, 'override.name');
    if (_bootState === 'booted') {
      throw new Error(`moduleLifecycle.override: cannot override "${name}" after boot completed`);
    }
    _overrides.set(name, instance);
  }

  /** Diagnostic: snapshot of declared module names. */
  function getDeclared() { return Array.from(_manifests.keys()); }

  /** Look up a declared module's resolved instance (post-boot). */
  function getInstance(name) {
    return _instances.has(name) ? _instances.get(name) : null;
  }

  /** Test cleanup: full registry reset. Clears manifests, instances, overrides,
   *  AND legacy initializers (which may have leaked in from other test files'
   *  side-effect requires). Tests must re-register anything they need. */
  function _resetForTests() {
    _manifests.clear();
    _instances.clear();
    _overrides.clear();
    initializers.clear();
    _bootState = 'pending';
  }

  function _resolveDepValue(name) {
    // Resolution order: override -> declared instance -> legacy globalThis lookup.
    if (_overrides.has(name)) return _overrides.get(name);
    if (_instances.has(name)) return _instances.get(name);
    if (Object.prototype.hasOwnProperty.call(globalThis, name)) {
      const v = globalThis[name];
      if (v !== undefined) return v;
    }
    return undefined;
  }

  function _instantiateManifest(m) {
    if (_overrides.has(m.name)) {
      const mock = _overrides.get(m.name);
      _instances.set(m.name, mock);
      for (const provName of m.provides) globalThis[provName] = mock;
      return;
    }
    const deps = {};
    for (const depName of m.deps) {
      const v = _resolveDepValue(depName);
      if (v === undefined) {
        throw new Error(
          `moduleLifecycle: "${m.name}" depends on "${depName}" which is neither a declared module, an override, nor an existing global. ` +
          `Declare "${depName}" via moduleLifecycle.declare() or ensure it is loaded before initializeAll() runs.`
        );
      }
      deps[depName] = v;
    }
    const api = m.init(deps);
    _instances.set(m.name, api);
    if (api !== undefined && api !== null) {
      for (const provName of m.provides) globalThis[provName] = api;
    }
  }

  // Initialization Registry (legacy + declare unified)
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
    if (_manifests.has(name)) {
      throw new Error(`moduleLifecycle.registerInitializer: "${name}" already declared via declare(); use one or the other, not both`);
    }
    initializers.set(name, { name, initFn, dependencies });
  }

  /**
   * Execute all registered initializers in topological order.
   * Throws on circular dependencies or missing dependencies.
   */
  function initializeAll() {
    if (_bootState === 'booted') {
      throw new Error('moduleLifecycle.initializeAll: already booted (call _resetForTests in tests)');
    }
    _bootState = 'booting';

    // Unified topo-sort across BOTH the legacy registerInitializer pool
    // and the manifest-declared pool. They share a name namespace; declare()
    // and registerInitializer() both reject collisions at registration time,
    // so each name resolves to exactly one entry kind.
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();

    function _entryFor(name) {
      if (initializers.has(name)) {
        const e = initializers.get(name);
        return { kind: 'init', name: e.name, deps: e.dependencies, runner: e.initFn };
      }
      if (_manifests.has(name)) {
        const m = _manifests.get(name);
        return { kind: 'manifest', name: m.name, deps: m.deps, runner: () => _instantiateManifest(m) };
      }
      return null;
    }

    function visit(name, requiredBy) {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`moduleLifecycle.initializeAll: Circular dependency detected involving "${name}"`);
      }
      visiting.add(name);

      const entry = _entryFor(name);
      if (!entry) {
        // Manifest deps that resolve to legacy globals at runtime are NOT
        // required to be registered here. Only fail when the missing name
        // is required by a registerInitializer entry (which has stricter
        // semantics) or by a manifest dep that ALSO doesn't exist as a
        // global. We can't check global existence at sort time (modules
        // load AFTER this function is defined), so for manifest deps we
        // accept the missing-from-registry case silently and let
        // _instantiateManifest's globalThis lookup catch unresolved
        // references at instantiation time with a clear error.
        if (requiredBy && requiredBy.kind === 'init') {
          throw new Error(`moduleLifecycle.initializeAll: "${requiredBy.name}" depends on "${name}" but "${name}" is not registered`);
        }
        visiting.delete(name);
        return;
      }

      for (const dep of entry.deps) {
        visit(dep, entry);
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(entry);
    }

    for (const name of initializers.keys()) visit(name, null);
    for (const name of _manifests.keys()) visit(name, null);

    for (const entry of sorted) {
      entry.runner();
    }

    _bootState = 'booted';
  }

  return {
    create,
    registerInitializer,
    initializeAll,
    declare,
    override,
    getDeclared,
    getInstance,
    _resetForTests,
  };
})();
