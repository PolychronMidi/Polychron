# Module Lifecycle Registry

`moduleLifecycle` is the project's stepping-stone toward full dependency
injection. It captures ~75% of DI's benefits while preserving the existing
IIFE+globals pattern for unmigrated modules. Eventual full DI later
becomes a mechanical sweep, not a redesign.

## Two registration paths

Pre-existing modules use one of:

```js
// Path A: legacy IIFE + globals (most modules)
metaProfiles = (() => {
  // ... build API ...
  return { setActive, getAxis, /* ... */ };
})();

// Path B: legacy IIFE + registerInitializer (modules with deferred init logic)
moduleLifecycle.registerInitializer('metaProfiles', () => {
  // runs after all listed deps have initialized
}, ['metaProfileDefinitions']);
```

Migrated modules use:

```js
// Path C: declare() -- the stepping stone
moduleLifecycle.declare({
  name: 'metaProfiles',
  subsystem: 'conductor',
  deps: ['metaProfileDefinitions', 'validator'],
  provides: ['metaProfiles'],
  reads: [],                                   // cross-subsystem reads (firewall metadata)
  emits: ['L0_METAPROFILE_CHANGE'],            // L0 channels written
  init: (deps) => {
    // deps.metaProfileDefinitions and deps.validator are GUARANTEED resolved
    // No safePreBoot wrapping. No worry about boot order.
    return {
      setActive: (...) => { /* ... */ },
      getAxis: (...) => { /* ... */ },
      // ...
    };
    // The return value is bound to the global `metaProfiles` (each name in `provides`)
  },
});
```

## Migration recipe (per module)

1. **Replace the IIFE** at the top of the file with a `moduleLifecycle.declare({...})` call.
2. **Move all the IIFE body** into the `init: (deps) => { ... }` function. Inside, reference dependencies via `deps.X` instead of the global `X`. Locally-scoped helpers (private functions, constants, state Maps) all stay inside `init` -- they form the closure backing the returned API.
3. **Return the public API** from `init`. The registry binds it to each name in `provides`.
4. **Drop any `safePreBoot.call(() => x.foo(), fb)` wraps** for deps that are now declared. The `deps` argument guarantees they're resolved before `init()` runs.
5. **Drop any `moduleLifecycle.registerInitializer('foo', initFn, ['bar'])`** in the same file -- the manifest's `init` IS the initializer.
6. **List `deps` precisely — top-of-init touches ONLY.** A dep is anything `init` body references *at top level* (assignments, immediate function calls, V.create, etc). Names referenced *inside function bodies* the init returns are NOT deps -- those functions run post-boot when their globals have been loaded by the standard require chain. Over-listing deps causes the registry to defer instantiation when those globals haven't loaded yet, breaking patterns like trailing `crossLayerRegistry.register(...)` calls on the same line as the declare. Concretely:
   - `const V = deps.validator.create(...)` -> `validator` IS a dep (top-level)
   - `function foo() { return signalReader.snapshot(); }` -> `signalReader` is NOT a dep (inside a function)
   - `conductorIntelligence.registerRecorder(...)` at the bottom of init body -> `conductorIntelligence` IS a dep (top-level call)
7. **List `provides` precisely.** Usually just `[name]` so the existing global identifier keeps pointing at the same value. Multi-provides is supported when a module exposes multiple identifiers.
8. **Fill `subsystem`, `reads`, `emits`** for forward firewall enforcement. Today they're advisory; phase 2's verifier upgrade will use them.

## Test path

```js
// In a test file
const ML = global.moduleLifecycle;

ML._resetForTests();                                       // wipe registry
ML.override('metaProfileDefinitions', mockDefsObject);     // mock a dep
ML.declare({ /* the module-under-test's manifest */ });
ML.initializeAll();
// Now `metaProfiles` global is the real init's return value, but
// `metaProfileDefinitions` is the mock -- the consumer wired with the mock.
```

The override beats the manifest's own `init`; dependents see the mock; no
global namespace surgery required.

## What the registry guarantees

| Guarantee | How |
|---|---|
| Boot order from deps | Topo-sort across declare + registerInitializer pools at `initializeAll()` time |
| No partial init | Cycle detection throws; missing-dep throws |
| No double init | `_bootState` machine rejects second `initializeAll` |
| No post-boot mutation | `declare`/`override` rejected after boot |
| Deduplicated namespace | `declare` rejects collision with prior declare OR registerInitializer of same name |
| Mockable | `override(name, mock)` before boot; mocks satisfy dependents |

## What the registry does NOT do (yet)

| Limitation | When it changes |
|---|---|
| Modules still mutate globals (registry binds the return value, but legacy code can also self-mutate) | Full DI phase: modules become file-scoped exports, no global side-effects |
| Per-instance modules (every name is a singleton) | Full DI phase: `init(deps)` becomes `factory(deps) -> instance` for non-singleton needs |
| Type-checked dep arguments inside the module body | Full DI phase: TypeScript imports + interfaces replace ambient declarations |
| Auto-generated globals.d.ts entries from manifests | Phase 2: extend `scripts/pipeline/generators/generate-globals-dts.js` to read manifests |
| Cross-subsystem `reads`/`emits` firewall enforcement | Phase 2: extend `check-module-manifests.js` to validate against `feedback_graph.json` |

## Phase progression

- **Phase 1 (done)**: registry + manifest schema + tests + verifier scaffolding + this doc
- **Phase 2**: migrate one substantive subsystem (recommended: `conductor`). Extend the verifier to enforce manifest/firewall consistency. Extend the d.ts generator to read manifests.
- **Phase 3**: migrate remaining subsystems incrementally; each migration drops `safePreBoot` calls.
- **Phase 4**: collapse parallel registries (`crossLayerRegistry`, `conductorIntelligence`, `feedbackRegistry`, `metaControllerRegistry`) into the unified one.
- **Full DI later**: convert `init(deps) { return api }` to ESM-style file-scoped exports. Modules reference `deps.X` exclusively; the global namespace is retired.
