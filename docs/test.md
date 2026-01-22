# Testing Guide — Test Protocol 🧪

> **Status**: Core Process / Contributor Guide

## Overview

This document summarizes Polychron's **Test Protocol** and practical guidance for writing tests that exercise real implementations (no mocks for core logic), follow global state patterns, and align with the project's experimental, integration-first philosophy.

**Core Responsibilities:**
- Document how to run and author tests that exercise real implementations (integration-style)
- Provide concrete examples and helper snippets (from `test/helpers.ts`) to onboard contributors
- Explain the test architecture (Vitest, side-effect imports, `setupGlobalState`, `createTestState`, logging toggles)

---

## Key Principles

- **Test real implementations, not mocks.** Tests must catch actual integration bugs and avoid divergence between mocks and real code.
- **Side-effect imports first.** Use top-level side-effect imports for global initialization (e.g., `import '../../src/sheet.js'`) then import specific symbols.
- **Use `setupGlobalState()` only for existing tests that rely on globals; prefer `createTestState()` and dependency injection.** When updating tests, keep tests passing while replacing global state usage incrementally.
- **Instrumentation via `__POLYCHRON_TEST__`.** Use `globalThis.__POLYCHRON_TEST__` to toggle logging, inject instrumentation, and observe internal state.
- **Vitest integration.** Tests use Vitest as the framework and prefer `--run` for CI runs. Use `npm run test` locally to run the full suite.

---

## Test Architecture & Patterns

- Framework: **Vitest** (see `vitest.config.mjs`) ⚙️
- Import pattern: Side-effect imports for globals followed by specific imports:

```ts
// Example pattern
import '../../src/backstage.js';
import '../../src/sheet.js';
import { createTestContext } from '../test/helpers';
```

- Global state initialization: `setupGlobalState()` (deprecated) vs `createTestState()` (preferred). Prefer explicit `ICompositionContext` passing to functions when possible.
- Mock usage: Only for external callbacks (`vi.fn()`), not for core algorithmic modules.

---

## Common Test Helpers

<!-- BEGIN: snippet:TestHelpers_createTestState -->
```typescript
// createTestState (copied from test/helpers.ts)
export function createTestState(): CompositionState {
  const state = new CompositionStateService();

  // Expose to test namespace for instrumentation
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  globalThis.__POLYCHRON_TEST__.state = state;

  return state;
}
```
<!-- END: snippet:TestHelpers_createTestState -->

<!-- BEGIN: snippet:TestHelpers_createTestContext -->
```typescript
// createTestContext (copied from test/helpers.ts)
export function createTestContext(overrides?: Partial<ICompositionContext>): ICompositionContext {
  const state = createTestState();
  const services = new DIContainer();
  const eventBus = new CompositionEventBusImpl();
  const cancelToken = new CancellationTokenImpl();

  // Set default timing values on state
  state.numerator = 4;
  state.denominator = 4;
  state.BPM = 120;
  state.PPQ = 480;
  state.beatCount = 0;
  state.beatStart = 0;
  state.measureStart = 0;
  state.phraseStart = 0;
  state.sectionStart = 0;

  const ctx: ICompositionContext = {
    state,
    services,
    eventBus,
    cancelToken,
    BPM: 120,
    PPQ: 480,
    ...overrides
  };

  return ctx;
}
```
<!-- END: snippet:TestHelpers_createTestContext -->

<!-- BEGIN: snippet:TestHelpers_setupGlobalState -->
```typescript
// setupGlobalState (deprecated)
export function setupGlobalState(): void {
  globalThis.c = [];
  globalThis.csvRows = [];
  globalThis.numerator = 4;
  globalThis.denominator = 4;
  globalThis.BPM = 120;
  globalThis.PPQ = 480;
  // ...other existing global resets
}
```
<!-- END: snippet:TestHelpers_setupGlobalState -->

<!-- BEGIN: snippet:TestHelpers_setupTestLogging -->
```typescript
export function setupTestLogging(): void {
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  globalThis.__POLYCHRON_TEST__.enableLogging = true;
}
```
<!-- END: snippet:TestHelpers_setupTestLogging -->

> Note: These snippets are copied from `test/helpers.ts` to make the guide immediately useful. The docs pipeline currently auto-injects snippets for `/src` modules; if we want `docs/test.md` to auto-inject from `test/` files, we should extend `scripts/docs.js` to include `test/` files in the mapping.

---

## Commands

- Run the full suite (includes lint precheck):

```bash
npm run test
```

- Watch mode:

```bash
npm run test:watch
```

- Debug runs (optional, heavy, and opt-in):

The repository includes diagnostic scripts that are intentionally kept separate from the default test flow to avoid slowing down everyday runs and to reduce noisy output. To enable debug-only diagnostics that may perform heavy instrumentation (for example, `scripts/debug-unit-coverage.js`), set the `DEBUG_UNIT_COVERAGE` environment variable or use the cross-platform helper script:

```bash
# Linux / macOS (env directly)
DEBUG_UNIT_COVERAGE=1 npm run test

# Cross-platform helper (works on Windows too):
npm run test:debug
```

Notes:
- The debug script `scripts/debug-unit-coverage.js` now guards itself and will no-op unless `DEBUG_UNIT_COVERAGE` is set. This prevents accidental long runs when invoked directly.
- Prefer `npm run test:debug` for a portable way to execute the full test pipeline with diagnostics enabled.
- Consider running debug diagnostics on demand or in nightly CI jobs rather than on every PR to keep CI fast and deterministic.

- Docs maintenance:

```bash
npm run docs:fix    # Auto-link modules and inject snippets (for /src modules)
npm run docs:check  # CI-safe docs validation
```

---

## Update Tips

- When updating tests away from globals, prefer `createTestState()` + passing explicit context.
- Add integration tests that exercise multiple modules together rather than unit tests that mock core modules.

---

## Contribution Checklist ✅

- [ ] Add tests according to Test Protocol (no mocks for core modules)
- [ ] Add test helper usage and examples to `docs/test.md`
- [ ] Run `npm run docs:fix` and `npm run docs:check`
- [ ] Add any new docs checks to CI and update `TODO.md` and call `npm run am-i-done` when the task is finished
