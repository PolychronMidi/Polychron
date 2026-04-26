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
  // 2. Registry owns the namespace assignment. Modules `init(deps)` and
  //    return their API; the registry binds the return value to each
  //    name in `provides`. Inverts today's `name = (() => {...})()`
  //    pattern -- that's what lets full DI later be a mechanical sweep.
  // 3. `init(deps)` lifecycle replaces IIFE-at-require-time. Kills the
  //    171+ safePreBoot wrapper defensive guards because deps are
  //    GUARANTEED resolved before init() runs.
  // 4. Boot order derived from manifests via topo-sort, never maintained
  //    by hand. Adding a module = drop a file with declare(); nothing
  //    else changes.
  // 5. Test-mode override API: registry.override(name, mock) before
  //    initializeAll() lets tests swap any module without touching
  //    the namespace. Captures DI's testability win.
  //
  // Coexists with legacy IIFE+namespaced modules during migration.
  // A declared module CAN list legacy names as deps -- the registry
  // resolves them via dynamic namespace lookup at init time.
  // Strictness comes later when every module is migrated.
  //
  // Manifest schema:
  //   {
  //     name:       string                       -- unique identifier
  //     deps:       string[]                     -- depended-on modules (declared or legacy)
  //     provides:   string[]                     -- names the init return is bound to
  //     init:       (deps: object) => any        -- returns the module API
  //     subsystem?: string                       -- 'utils'|'conductor'|'rhythm'|... (firewall metadata)
  //     reads?:     string[]                     -- cross-subsystem reads (firewall metadata)
  //     emits?:     string[]                     -- L0 channels written (firewall metadata)
  //
  //     // Phase 4 unification: post-init registrations declared inline.
  //     // After init() returns, the registry calls the appropriate
  //     // sub-registries automatically -- migrated modules drop the
  //     // trailing crossLayerRegistry.register / conductorIntelligence.*
  //     // calls that previously lived after the IIFE close.
  //     crossLayerScopes?: string[]              -- crossLayerRegistry.register(name, api, scopes)
  //     conductorScopes?: string[]               -- conductorIntelligence.registerModule(name, api, scopes)
  //     recorder?: (ctx: any) => void            -- conductorIntelligence.registerRecorder(name, fn)
  //     stateProvider?: () => object             -- conductorIntelligence.registerStateProvider(name, fn)
  //   }
  //
  // Subsystem/reads/emits metadata is consumed by check-module-manifests.js;
  // the registry itself only needs name/deps/provides/init. The post-init
  // registration fields are honored by the registry post-instantiate.
  // ===================================================================

  // Initialization Registry (legacy + declare unified). Defined up front
  // so the manifest helpers below can reference it without a temporal
  // dead-zone forward reference.
  const initializers = new Map();

  /** @type {Map<string, object>} */
  const _manifests = new Map();
  /** @type {Map<string, any>} */
  const _instances = new Map();
  /** @type {Map<string, any>} */
  const _overrides = new Map();

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
    // Phase 4 post-init registrations.
    if (m.crossLayerScopes !== undefined) {
      V.assertArray(m.crossLayerScopes, `declare.manifest.crossLayerScopes for "${m.name}"`);
      for (let i = 0; i < m.crossLayerScopes.length; i++) V.assertNonEmptyString(m.crossLayerScopes[i], `declare.manifest.crossLayerScopes[${i}]`);
    }
    if (m.conductorScopes !== undefined) {
      V.assertArray(m.conductorScopes, `declare.manifest.conductorScopes for "${m.name}"`);
      for (let i = 0; i < m.conductorScopes.length; i++) V.assertNonEmptyString(m.conductorScopes[i], `declare.manifest.conductorScopes[${i}]`);
    }
    if (m.recorder !== undefined) V.requireType(m.recorder, 'function', `declare.manifest.recorder for "${m.name}"`);
    if (m.stateProvider !== undefined) V.requireType(m.stateProvider, 'function', `declare.manifest.stateProvider for "${m.name}"`);
  }

  /**
   * Declare a module manifest. If all dependencies are resolvable NOW
   * (other declared instances, overrides, or already-loaded namespace
   * values), init() runs IMMEDIATELY and the return value is bound to
   * each name in `provides`. Otherwise the manifest is deferred to a
   * pending list and instantiated by _drain() once its deps become
   * available (typically when another declare or initializeAll resolves
   * them).
   *
   * Eager instantiation matters because `mainBootstrap.assertBootstrapGlobals`
   * runs in main.js BEFORE moduleLifecycle.initializeAll() -- migrated
   * modules' namespaces must already be populated by the time the
   * bootstrap validator scans them.
   */
  function declare(manifest) {
    _validateManifest(manifest);
    if (_manifests.has(manifest.name)) {
      throw new Error(`moduleLifecycle.declare: duplicate manifest for "${manifest.name}"`);
    }
    if (initializers.has(manifest.name)) {
      throw new Error(`moduleLifecycle.declare: "${manifest.name}" already registered via registerInitializer; use one or the other, not both`);
    }
    // Implicit deps from post-init wiring fields. Manifests declaring
    // conductorScopes / recorder / stateProvider need conductorIntelligence
    // bound. Manifests declaring crossLayerScopes need crossLayerRegistry.
    const implicitDeps = [];
    if ((manifest.conductorScopes && manifest.conductorScopes.length > 0)
      || manifest.recorder || manifest.stateProvider) {
      if (!manifest.deps.includes('conductorIntelligence') && manifest.name !== 'conductorIntelligence') {
        implicitDeps.push('conductorIntelligence');
      }
    }
    if (manifest.crossLayerScopes && manifest.crossLayerScopes.length > 0) {
      if (!manifest.deps.includes('crossLayerRegistry') && manifest.name !== 'crossLayerRegistry') {
        implicitDeps.push('crossLayerRegistry');
      }
    }
    if (implicitDeps.length > 0) {
      manifest = Object.assign({}, manifest, { deps: [...manifest.deps, ...implicitDeps] });
    }
    _manifests.set(manifest.name, manifest);
    // Try to instantiate this manifest (and any pending dependents).
    _drain();
  }

  /**
   * Override a module instance for testing. Must be called BEFORE the
   * module declares (otherwise the module already instantiated with the
   * real init). The override's identity becomes the resolved instance and
   * is bound to each `provides` name -- init() is NOT called.
   */
  function override(name, instance) {
    V.assertNonEmptyString(name, 'override.name');
    if (_instances.has(name)) {
      throw new Error(`moduleLifecycle.override: cannot override "${name}" after instantiation; override BEFORE declare()`);
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
  }

  // Dynamic namespace lookup. The project's general convention is "naked
  // identifier access" (the lint rule no-restricted-globals enforces it).
  // BUT the registry NEEDS dynamic name-based access -- mainBootstrap.js
  // already does the same thing for its boot-time validation pass and uses
  // the same eslint-disable scope. Replacement: when the project moves to
  // pure DI later, this dynamic-access path goes away (modules will get
  // their deps via the deps argument exclusively).
  function _readNamespace(name) {
    /* eslint-disable no-restricted-globals,no-restricted-syntax */
    return Object.prototype.hasOwnProperty.call(globalThis, name) ? globalThis[name] : undefined;
    /* eslint-enable no-restricted-globals,no-restricted-syntax */
  }
  function _writeNamespace(name, value) {
    /* eslint-disable no-restricted-globals,no-restricted-syntax */
    globalThis[name] = value;
    /* eslint-enable no-restricted-globals,no-restricted-syntax */
  }

  function _resolveDepValue(name) {
    // Resolution order: override -> declared instance -> legacy namespace lookup.
    if (_overrides.has(name)) return _overrides.get(name);
    if (_instances.has(name)) return _instances.get(name);
    return _readNamespace(name);
  }

  function _canResolveDeps(manifest) {
    for (const depName of manifest.deps) {
      if (_overrides.has(depName)) continue;
      if (_instances.has(depName)) continue;
      // Legacy namespace lookup -- accept if already populated.
      if (_readNamespace(depName) !== undefined) continue;
      // If the dep is a yet-to-instantiate manifest, it MIGHT become available
      // later but isn't NOW. Defer this manifest.
      if (_manifests.has(depName)) return false;
      // Same for legacy registerInitializer entries: they haven't run yet, so
      // their sentinel isn't in _instances. Defer.
      if (initializers.has(depName)) return false;
      // Otherwise the dep is genuinely undefined. We let _drain skip it for
      // now; initializeAll's final pass will surface a clear error if it
      // remains unresolvable.
      return false;
    }
    return true;
  }

  // Try to instantiate every pending manifest whose deps are now resolvable.
  // Idempotent and re-entrant -- called after declare(), after each legacy
  // initializer runs, and from initializeAll. Stops when no progress is made.
  function _drain() {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [name, m] of _manifests.entries()) {
        if (_instances.has(name)) continue;
        if (!_canResolveDeps(m)) continue;
        _instantiateManifest(m);
        progressed = true;
      }
    }
  }

  function _instantiateManifest(m) {
    if (_overrides.has(m.name)) {
      // Override path: skip init() entirely, bind mock to all provides.
      const mock = _overrides.get(m.name);
      _instances.set(m.name, mock);
      for (const provName of m.provides) _writeNamespace(provName, mock);
    } else {
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
        for (const provName of m.provides) _writeNamespace(provName, api);
      }
      // Phase 4: honor post-init registration fields. Each sub-registry is
      // looked up via the namespace (it's a legacy global today; later both
      // could be declared modules). When the field is present, the registry
      // dispatches to the sub-registry's appropriate API on the instance.
      // Errors here are surfaced -- the manifest authored these fields, so
      // missing sub-registries are real bugs.
      if (api && m.crossLayerScopes && m.crossLayerScopes.length > 0) {
        const reg = _readNamespace('crossLayerRegistry');
        if (!reg) throw new Error(`moduleLifecycle: "${m.name}" declares crossLayerScopes but crossLayerRegistry is not loaded`);
        reg.register(m.name, api, m.crossLayerScopes);
      }
      if (api && m.conductorScopes && m.conductorScopes.length > 0) {
        const ci = _readNamespace('conductorIntelligence');
        if (!ci) throw new Error(`moduleLifecycle: "${m.name}" declares conductorScopes but conductorIntelligence is not loaded`);
        ci.registerModule(m.name, api, m.conductorScopes);
      }
      if (m.recorder) {
        const ci = _readNamespace('conductorIntelligence');
        if (!ci) throw new Error(`moduleLifecycle: "${m.name}" declares recorder but conductorIntelligence is not loaded`);
        ci.registerRecorder(m.name, m.recorder);
      }
      if (m.stateProvider) {
        const ci = _readNamespace('conductorIntelligence');
        if (!ci) throw new Error(`moduleLifecycle: "${m.name}" declares stateProvider but conductorIntelligence is not loaded`);
        ci.registerStateProvider(m.name, m.stateProvider);
      }
    }
  }

  // (Legacy `initializers` Map declared above with the manifest state so
  // helpers above can reference it without forward declaration.)

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
    // If a declared module of the same name exists, register the initFn
    // under a derived "<name>:lateInit" key. The post-boot wiring (event
    // subscriptions, cross-module registrations) runs AFTER all declare()
    // manifests have eagerly instantiated -- which is the original
    // semantic registerInitializer was designed for. Avoids the rejection
    // that would force the caller to inline the wiring into init() and
    // hit reference errors when cross-module deps load later.
    const storeName = _manifests.has(name) ? `${name}:lateInit` : name;
    if (initializers.has(storeName)) {
      throw new Error(`moduleLifecycle.registerInitializer: duplicate "${storeName}"`);
    }
    initializers.set(storeName, { name: storeName, initFn, dependencies });
  }

  /**
   * Execute all registered initializers in topological order.
   * Throws on circular dependencies or missing dependencies.
   */
  function initializeAll() {
    // initializeAll's job is now to run any deferred work:
    //   1. Run legacy registerInitializer entries in topo order. After each
    //      runs, _drain() retries pending manifests that depended on it.
    //   2. Final _drain() catches any cross-pool stragglers.
    //   3. Verify every declared manifest has been instantiated; if any
    //      remain pending, surface a precise error.
    // Declared manifests with all-resolvable deps already instantiated at
    // declare() time (eager instantiation), so this is purely the legacy +
    // straggler path.

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
        // Wrap legacy initFn so a sentinel lands in _instances after it runs.
        // Manifests that depend on a legacy init name can then resolve via
        // _resolveDepValue -- they get `true` rather than the real API
        // (legacy initFn returns void), which is the right semantic: legacy
        // deps mean "must run before me," not "pass your API to me."
        return {
          kind: 'init',
          name: e.name,
          deps: e.dependencies,
          runner: () => { e.initFn(); _instances.set(e.name, true); },
        };
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
        // Manifest deps that resolve to legacy namespaces at runtime are
        // NOT required to be registered here. Only fail when the missing
        // name is required by a registerInitializer entry (which has
        // stricter semantics) or by a manifest dep that ALSO doesn't
        // exist as a namespace value. We can't check namespace existence
        // at sort time (modules load AFTER this function is defined), so
        // for manifest deps we accept the missing-from-registry case
        // silently and let _instantiateManifest's namespace lookup catch
        // unresolved references at instantiation time with a clear error.
        // For registerInitializer-kind entries, the dep MAY be a legacy
        // global that's bound by IIFE at file-require time (e.g. rhythmRegistry,
        // chordRegistry). Those are loaded before initializeAll runs, so the
        // dep is already satisfied at execution time. Only fail if the
        // namespace ALSO has no value bound, which would mean the dep is
        // genuinely unresolvable.
        if (requiredBy && requiredBy.kind === 'init') {
          if (_readNamespace(name) === undefined) {
            throw new Error(`moduleLifecycle.initializeAll: "${requiredBy.name}" depends on "${name}" but "${name}" is neither a registered initializer/manifest nor an existing global`);
          }
          // Legacy global is bound -- treat dep as satisfied without recursing.
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
      // Skip manifest entries already instantiated by eager declare().
      if (entry.kind === 'manifest' && _instances.has(entry.name)) continue;
      entry.runner();
      // After each entry runs, drain pending manifests in case the new
      // namespace value resolves any deps.
      _drain();
    }

    // Final pending check: any manifest still uninstantiated is a real bug.
    const stillPending = [];
    for (const [name] of _manifests.entries()) {
      if (!_instances.has(name)) stillPending.push(name);
    }
    if (stillPending.length > 0) {
      throw new Error(
        `moduleLifecycle.initializeAll: ${stillPending.length} manifest(s) failed to instantiate -- unresolved deps: ${stillPending.join(', ')}`
      );
    }
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
