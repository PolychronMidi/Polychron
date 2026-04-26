# Module Registry (moduleLifecycle.declare)

Single source of truth for module registration, boot order, and post-boot wiring.

`moduleLifecycle.declare(manifest)` replaces the legacy `name = (() => {...})()`
IIFE pattern. Manifests are processed by topo-sort: each module's `init(deps)`
runs only after every name in `deps` is bound. The registry assigns the return
value of `init` to the names in `provides`. Post-init wiring (cross-layer
registration, recorders, scoped resets) flows through dedicated manifest fields.

## Manifest schema

```js
moduleLifecycle.declare({
  name: 'moduleName',                      // unique identifier
  subsystem: 'conductor',                  // 'utils' | 'conductor' | 'rhythm' | 'time' | 'composers' | 'fx' | 'crossLayer' | 'writer' | 'play'
  deps: ['validator', 'metaProfiles'],     // names that MUST be bound before init()
  provides: ['moduleName'],                // names the init return is bound to (typically [name])
  init: (deps) => {                        // returns the module API
    const V = deps.validator.create('moduleName');
    const metaProfiles = deps.metaProfiles;
    // ... module body ...
    return { publicMethod, anotherMethod };
  },

  // === Post-init wiring fields (all optional) ===
  crossLayerScopes: ['all', 'section'],    // -> crossLayerRegistry.register(name, api, scopes)
  conductorScopes: ['section'],            // -> conductorIntelligence.registerModule(name, api, scopes)
  recorder: (ctx) => api.refresh(ctx),     // -> conductorIntelligence.registerRecorder(name, fn)
  stateProvider: () => ({ ...api.snapshot() }),  // -> conductorIntelligence.registerStateProvider(name, fn)

  // === Optional metadata (consumed by check-module-manifests verifier) ===
  reads: ['LM.activeLayer'],               // cross-subsystem reads (firewall metadata)
  emits: ['L0_TEST_CHANNEL'],              // L0 channels written
});
```

## Lifecycle

```
require time
  └─ declare() called → manifest queued
     └─ if every dep is already bound: instantiate eagerly, bind globals,
        run post-init wiring fields
     └─ else: defer (joins the pending pool)

initializeAll() (called from main.js BEFORE assertBootstrapGlobals)
  └─ topo-sort drains pending manifests + legacy registerInitializer entries
  └─ runs <name>:lateInit registerInitializer entries (post-boot wiring that
     needs all modules loaded; e.g. eventBus subscriptions)
```

## When to use which lifecycle hook

| Need                                                         | Field            |
| ------------------------------------------------------------ | ---------------- |
| API setup, dep-aliasing, state initialization                | `init(deps)`     |
| Reset method called at section / phrase / all boundaries     | `conductorScopes`|
| Reset method called at cross-layer boundaries                | `crossLayerScopes`|
| Per-tick refresh callback (ticked by conductorIntelligence)  | `recorder`       |
| Diagnostic snapshot (read by trace pipeline)                 | `stateProvider`  |
| Post-boot wiring that needs ALL modules loaded               | `registerInitializer('name', fn)` inside init body |

The last row deserves explanation: `eventBus.on(...)` subscriptions, late
cross-module wiring, and any setup that depends on modules that haven't been
declared yet must use `registerInitializer` from inside the `init()` body. The
registry stores it under `<name>:lateInit` and runs it during the
initializeAll() topo-sort drain — by that point every module is loaded.

## Migration patterns

### Pattern 1: simple IIFE + crossLayerRegistry.register

```js
// before
moduleName = (() => {
  const V = validator.create('moduleName');
  // ...
  return { ... };
})();
crossLayerRegistry.register('moduleName', moduleName, ['all']);

// after
moduleLifecycle.declare({
  name: 'moduleName',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['moduleName'],
  crossLayerScopes: ['all'],
  init: (deps) => {
    const V = deps.validator.create('moduleName');
    // ...
    return { ... };
  },
});
```

### Pattern 2: registerInitializer with eventBus subscription

```js
// before
moduleName = (() => {
  function initialize() {
    const EVENTS = V.getEventsOrThrow();
    eventBus.on(EVENTS.X, handler);
  }
  moduleLifecycle.registerInitializer('moduleName', initialize);
  return { initialize, ... };
})();

// after
moduleLifecycle.declare({
  name: 'moduleName',
  deps: ['validator'],
  provides: ['moduleName'],
  init: (deps) => {
    const V = deps.validator.create('moduleName');
    function initialize() {
      const EVENTS = V.getEventsOrThrow();
      eventBus.on(EVENTS.X, handler);
    }
    // Defer initialize() to AFTER all modules loaded -- the lateInit hook.
    moduleLifecycle.registerInitializer('moduleName', initialize);
    return { ... };
  },
});
```

## Parallel-registry consolidation roadmap

Today the project has 4 parallel registries:

- `moduleLifecycle` — boot order, manifest declarations, lifecycle hooks
- `crossLayerRegistry` — cross-layer module registration + scoped resets
- `conductorIntelligence` — recorders, state providers, density bias, scoped resets
- `feedbackRegistry` — feedback loop topology declarations
- `metaControllerRegistry` — hypermeta controller registry

The manifest fields (`crossLayerScopes`, `conductorScopes`, `recorder`,
`stateProvider`) absorb the most common operations of `crossLayerRegistry` and
`conductorIntelligence`. Future moves:

1. **Add manifest fields for the remaining operations**: `densityBias`,
   `signalSource`, `feedbackLoop`, `metaController`. Each existing
   registry-method becomes a manifest field that the registry dispatches to
   the appropriate sub-registry post-init.

2. **Deprecate direct sub-registry calls**: an ESLint rule (similar to
   `no-bare-declared-global-in-init`) would warn when a module calls
   `crossLayerRegistry.register(...)` directly instead of declaring
   `crossLayerScopes` in its manifest.

3. **Unify under `moduleLifecycle`**: once every operation flows through the
   manifest, the parallel registries become internal implementation details
   of moduleLifecycle, not separate APIs. The `crossLayerRegistry` /
   `conductorIntelligence` globals can be re-exported from moduleLifecycle as
   discriminated kinds (`moduleLifecycle.byKind('crossLayer')`,
   `moduleLifecycle.byKind('conductor')`).

4. **Auto-generate `globals.d.ts` from manifests** (already done; see
   `scripts/pipeline/generators/generate-manifest-globals.js`). The registry
   becomes the single source of truth for which names are bound.

## Verifiers

- `check-safe-preboot-audit` — ratchets safePreBoot wrap count downward.
- `check-module-manifests` — validates manifest shape, subsystem, provides
  consistency.
- `no-bare-declared-global-in-init` (ESLint, warn) — flags bare references
  to declared modules inside init() bodies; should use `deps.X` or alias
  via `const X = deps.X`.

## When NOT to migrate to declare()

Keep the legacy IIFE pattern for:

- **Foundational utilities** loaded BEFORE the registry exists (`validator`,
  `moduleLifecycle` itself, `safePreBoot`, `eventCatalog`, `trustSystems`,
  `feedbackRegistry`).
- **Helper modules with no lifecycle wiring** (no recorder, no scoped resets,
  no cross-module deps that need ordering). Wrapping them in declare() adds
  ceremony without benefit.

Currently 18 IIFE-pattern modules remain. They are intentional.
