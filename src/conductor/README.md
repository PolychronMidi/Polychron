---
name: conductor
rules:
  - Never hand-tune meta-controller constants — modify controller logic instead (Hypermeta-First principle)
  - Never set coherentThresholdScale per-profile — the regime self-balancer owns it
  - Never add manual axis floors/caps/thresholds; diagnose why the responsible controller isn't working instead
  - Bias bounds are locked — snapshot after legitimate structural changes with `node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds`
  - Controllers self-register via `metaControllerRegistry.register()` at load time; query topology via `getAll()` / `getById()` / `getByAxis()`
info: |
  The hypermeta layer — 19 self-calibrating controllers that own every coupling target,
  regime distribution, pipeline centroid, flicker range, trust starvation response,
  progressive strength, gain budget, axis equilibration, phase energy floor, per-pair
  gain ceiling, section-0 warmup ramp, and coherentThresholdScale. 93 bias registrations
  are validated against scripts/pipeline/bias-bounds-manifest.json on every run.
  This directory IS the control authority; cross-layer and other subsystems consume
  signals via conductorIntelligence + signalReader, never by directly reading state.
children:
  signal/: Signal extraction layer (profiling + meta-observer stages)
  signal/meta/: Meta-controllers; the actual hypermeta brains — rule-dense subtree
  signal/profiling/: L0 recorders and feature extractors feeding the meta layer
  dynamics/: dynamismEngine + pulse — per-beat drive calculation
  harmonic/: Harmonic tension + interval guards
  journey/: Section-arc narrative + climax detection
  melodic/: Melodic dimension scoring + fresh-dimension tracking
---

# Conductor

The hypermeta subsystem. Signal extraction → meta-observation → self-calibration. Everything here must preserve the invariants in `check-hypermeta-jurisdiction.js` (4-phase validator).

See `doc/SUBSYSTEMS.md` and `doc/TUNING_MAP.md` for architectural context.
