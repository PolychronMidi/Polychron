# coupling/homeostasis

Per-beat global-gain multiplier management for the coupling engine. Two entry points at different cadences — **never swap them**:

- `homeostasisTick.tick()` — called every beat-layer entry (~418/run); handles proportional control, tail recovery, floor recovery, exceedance braking, and time-series capture
- `homeostasisRefresh.refresh()` — called per measure (~78/run); heavier recalculation pass

All mutable state lives in `homeostasisState`; all constants in `homeostasisConstants`. Neither should be imported directly by `coupling/` modules above — access goes through `couplingHomeostasis`.

<!-- HME-DIR-INTENT
rules:
  - tick() fires per-beat, refresh() fires per-measure — never call refresh() from a beat handler or tick() from a measure handler
  - All state in homeostasisState, all constants in homeostasisConstants — coupling/ modules above access through couplingHomeostasis only
-->
