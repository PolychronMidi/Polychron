# SRC

Rules for `src/`, the polyrhythmic composition engine.

Read this before editing engine code. Use [composition-full.md](composition-full.md) when you
need the full architecture, subsystem map, tuning context, or historical
design primitives.

## Judgment Calls

- Keep files focused. Target <=200 lines; hard project ceiling is enforced
  elsewhere.
- Prefer the existing manager/helper shape. A subsystem has one public manager
  or facade; helpers load before the consumer through `index.js`.
- Mutable per-beat state that is written per layer and read by both layers must
  be per-layer: `LM.perLayerState` or a `byLayer` map keyed by
  `LM.activeLayer`.
- Cross-layer modules read conductor signals through `conductorSignalBridge`;
  do not reach into conductor state directly.
- Use L0 channels for cross-module event flow where a direct call would create
  a hidden coupling.
- Lab sketches must contain audible implementation. A profile-only `postBoot()`
  is an empty sketch.
- A pipeline step with exit 0 can still contain real failures. Check
  `output/metrics/pipeline-summary.json` and error-pattern output.

## Fast Links

- Project orientation: [README.md](../README.md)
- Agent rules: [AGENTS.md](templates/AGENTS.md)
- Full engine reference: [composition-full.md](composition-full.md)
- HME reference: [self-coherence.md](self-coherence.md)
