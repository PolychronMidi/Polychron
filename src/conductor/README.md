# conductor

The hypermeta layer — 19 self-calibrating controllers that own every coupling target, regime distribution, pipeline centroid, flicker range, trust starvation response, progressive strength, gain budget, axis equilibration, phase energy floor, per-pair gain ceiling, section-0 warmup ramp, and `coherentThresholdScale`. 93 bias registrations are validated against `scripts/pipeline/bias-bounds-manifest.json` on every run.

This directory **is** the control authority. Cross-layer and other subsystems consume signals via `conductorIntelligence` + `signalReader`, never by directly reading state. Controllers self-register via `metaControllerRegistry.register()` at load time; query the topology with `getAll()` / `getById()` / `getByAxis()`.

## Structure

- `signal/` — signal extraction layer (profiling + meta-observer stages)
- `signal/profiling/` — L0 recorders and feature extractors feeding the meta layer
- `signal/meta/` — meta-controllers; the actual hypermeta brains
- `dynamics/` — `dynamismEngine` + pulse; per-beat drive calculation
- `harmonic/` — harmonic tension + interval guards
- `journey/` — section-arc narrative + climax detection
- `melodic/` — melodic dimension scoring + fresh-dimension tracking

See [doc/SUBSYSTEMS.md](../../doc/SUBSYSTEMS.md) and [doc/TUNING_MAP.md](../../doc/TUNING_MAP.md) for architectural context. Any change here must preserve the invariants validated by `check-hypermeta-jurisdiction.js` (4 phases).

<!-- HME-DIR-INTENT
rules:
  - Bias bounds are locked — snapshot after structural changes via `check-hypermeta-jurisdiction.js --snapshot-bias-bounds`
  - Controllers self-register via `metaControllerRegistry.register()` at load time; query topology via `getAll()` / `getById()` / `getByAxis()`
  - When an axis is suppressed/dominant, diagnose WHY the responsible controller isn't working — don't add manual floors/caps
-->
