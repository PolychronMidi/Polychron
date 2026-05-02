# SRC -- Composition Engine Rules

Rules for code under `src/` (the polyrhythmic engine). The two CLAUDE.md
meta-rules apply here too: keep lean, and if a rule is auto-enforced
don't document it -- improve the enforcement instead.

For orientation, see [README.md](../README.md), [HME_MENTAL_MODEL.md](HME_MENTAL_MODEL.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [SUBSYSTEMS.md](SUBSYSTEMS.md),
[HYPERMETA.md](HYPERMETA.md).

## Judgment calls (not lint-enforced)

- **File size target <=200 lines.** When exceeded, extract a focused helper loaded BEFORE the consumer.
- **Single-Manager Hub per subsystem.** One `*Manager` (Facade + service locator); helpers load first via `index.js`, then the manager.
- **New mutable per-layer state** needs per-layer treatment if written per-beat AND read by both layers -- either in `LM.perLayerState` or a `byLayer` map keyed by `LM.activeLayer`.
- **Lab sketches:** every `postBoot()` must contain real implementation. A `setActiveProfile()`-only postBoot is empty.
- **Pipeline non-fatal steps:** a step marked OK with exit 0 can still contain real failures. Check `errorPatterns` in `output/metrics/pipeline-summary.json`.
