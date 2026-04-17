# conductor/signal/profiling

Regime classification and phase-space trajectory analysis. Two authorities live here:

- **`regimeClassifier`** — classifies each beat into `coherent / evolving / exploring / oscillating` with hysteresis, dwell-time enforcement, and starvation recovery. Dwell thresholds are in `_SEC` (seconds-based) form; the legacy beat-count fields are kept for reference but are **not authoritative**.
- **`systemDynamicsProfiler`** — 6-dimensional phase-space analysis (`density, tension, flicker, entropy, trust, phase`). Owns `getSnapshot()`. The `.couplingMatrix` field inside that snapshot is **firewall-protected** — only the coupling engine, meta-controllers, profiler internals, diagnostics, and pipeline plumbing may read it.

`entropyAmplificationController` and `regimeReactiveDamping` are meta-controllers that live here because they depend directly on regime state; their constants are owned by the controller logic, not by callers.

## Dwell time contract

Always compare against `_SEC` constants (e.g. `COHERENT_HARD_CAP_SEC`). Beat-based legacy fields (`COHERENT_MAX_DWELL`, `EVOLVING_MAX_DWELL`, etc.) exist for reference only and will diverge from wall-clock reality at non-standard tempos.

<!-- HME-DIR-INTENT
rules:
  - Never read .couplingMatrix from getSnapshot() outside the coupling engine, meta-controllers, or diagnostics — local/no-direct-coupling-matrix-read enforces this
  - Use `_SEC` dwell constants for all time comparisons; beat-count legacy fields are non-authoritative and will diverge at non-standard tempos
  - `regimeReactiveDamping` and `entropyAmplificationController` constants are owned by their controller logic — never patch from callers
-->
