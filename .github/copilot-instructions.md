# Polychron - Coding Rules

> Concise rules guide for AI assistants and contributors.
> For project overview and architecture, see [README.md](../README.md).

## Run

```bash
npm run main   # the ONE command - lint, typecheck, generate output
```

Wait for completion before acting on results. Output lands in `output/`, logs in `log/`.

## Five Core Principles

### 1. Globals And Clean Self-Documenting Code

Globals are assigned as side-effects of `require()` calls in `index.js` files. Never use `global.`, `globalThis.`, or `/* global */` comments (ESLint-enforced).

- Reference globals directly - never alias into intermediary variables.
- To add a new global: create a side-effect module, require it from the subsystem's `index.js`, declare in `globals.d.ts`. **Never hand-edit `VALIDATED_GLOBALS`** - `scripts/generate-globals-dts.js` rewrites it automatically.
- Boot validation proves every global exists before the main loop. ESLint `local/no-typeof-validated-global` bans redundant `typeof` probes.

### 2. Fail Fast - Loud Crashes, Never Silent Corruption

Every module throws on bad input. No silent early returns. No `|| 0` fallbacks. No graceful degradation.

Use `validator.create('ModuleName')` for all validation:
```js
const V = validator.create('ModuleName');
const ms = V.requireFinite(timeMs, 'timeMs');
```
Use `optionalFinite(val, fallback)` **only** for legitimately optional numerics.

### 3. Self-Registration

Modules self-register at load time. Two registries:
- **`crossLayerRegistry`** - `register(name, module, scopes)` where scopes ⊆ `['all','section','phrase']`
- **`conductorIntelligence`** - `registerDensityBias`, `registerTensionBias`, `registerFlickerModifier`, `registerRecorder`, `registerStateProvider`, `registerModule`

To add a module: write the file, self-register at end of IIFE, require from subsystem `index.js`.

### 4. Single-Manager Hub per Subsystem

One `*Manager` per subsystem (Facade + service locator). Helpers load first via `index.js`, then the manager. When a file exceeds ~200 lines, extract a focused helper loaded **before** the consumer.

### 5. Coherent Files, One Responsibility

Target ≤ 200 lines. File name matches main export. `const` and pure functions preferred. Comments reserved for complex logic. Only classes use PascalCase; everything else camelCase.

## Code Style Rules

- **Language:** JavaScript (CommonJS), TypeScript checking via `tsc --noEmit`
- **Console output:** script start, successful output, and temporary debug traces only. Limited `console.warn('Acceptable warning: ...')`.
- **No ad-hoc validation:** use `validator`, not `typeof` / `|| []` / `|| 0` / ternary fallbacks.
- **No typeof on boot-validated globals:** trust bootstrap; reference directly.
- **Globals are truth:** initialize correctly at the source. Never sanitize downstream.

## Load Order

`src/index.js` requires subsystems in this exact order:

```
utils - conductor - rhythm - time - composers - fx - crossLayer - writer - play
```

Each subsystem `index.js`: helpers first, then manager/orchestrator last.

## Architectural Boundaries

- **Cross-layer cannot write to conductor** - only local `playProb`/`stutterProb` modifications and `explainabilityBus` diagnostics.
- **Signal reading:** always through `signalReader`, never `conductorIntelligence.getSignalSnapshot()` directly.
- **New feedback loops** must register with `feedbackRegistry` to prevent catastrophic resonance.
- **Inter-module communication** via `absoluteTimeGrid` channels, not direct calls.

## Custom ESLint Rules

13 project-specific rules in `scripts/eslint-rules/`:

- **`case-conventions`** - PascalCase for classes, camelCase for everything else
- **`no-conductor-registration-from-crosslayer`** - prevent cross-layer modules from registering with conductor
- **`no-console-acceptable-warning`** - restrict `console.warn` to `'Acceptable warning: ...'` format
- **`no-direct-signal-read`** - ban `conductorIntelligence.getSignalSnapshot()` - use `signalReader`
- **`no-math-random`** - ban `Math.random()` - use project random sources
- **`no-non-ascii`** - ban non-ASCII characters in source
- **`no-requires-outside-index`** - restrict `require()` to `index.js` files
- **`no-silent-early-return`** - ban silent early returns - fail fast
- **`no-typeof-validated-global`** - ban `typeof` checks on boot-validated globals
- **`no-unstamped-validator`** - require module name stamp on `validator.create()`
- **`no-useless-expose-dependencies-comments`** - ban `/* expose-dependencies */` comments
- **`only-error-throws`** - require `throw new Error(...)` - no throwing strings/objects
- **`validator-name-matches-filename`** - require validator stamp to match filename

## Related Documentation

- [README.md](../README.md) - Comprehensive project overview, architecture, subsystem details, diagnostics
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Beat lifecycle deep-dive, signal flow from conductor to emission
- [TUNING_MAP.md](../TUNING_MAP.md) - Feedback loop constants, interaction partners, cross-constant invariants
