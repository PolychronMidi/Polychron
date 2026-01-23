# trace.ts

Provides tracing utilities used across the system for diagnostic logging.

Exports:

- `shouldTrace(mode: TraceMode): boolean` — whether the current configured trace mode allows the requested level.
- `trace(mode: TraceMode, ...args)` — logs to stderr when allowed.
- `traceWarn(mode: TraceMode, ...args)` — logs warnings to stderr when allowed.

Configuration is driven via `POLYCHRON_TRACE` env var or `poly.test._traceMode` in tests.
