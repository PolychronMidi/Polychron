# Meta-controllers

The actual hypermeta brains. Every controller self-registers at load time via `metaControllerRegistry.register()` and is queryable by id / axis / all. The 19 registered controllers own every coupling target, regime distribution, pipeline centroid, gain budget, axis equilibration, phase energy floor, per-pair gain ceiling, and `coherentThresholdScale` — they *are* the control authority this subtree is named for.

Bias registrations live in `scripts/pipeline/bias-bounds-manifest.json` (93 entries) and are validated by `check-hypermeta-jurisdiction.js`. Any controller that registers a bias outside its declared `[lo, hi]` range fails the pipeline. Snapshot after legitimate structural changes with `--snapshot-bias-bounds`.

## Current controllers

- `criticalityEngine` — per-axis pressure calculator
- `dimensionalityExpander` — adds slack to axes flagged as suppressed
- `conductorMetaWatchdog` — meta-level invariant checker (catches controllers that fight each other)
- `metaControllerRegistry` — self-registration + topology query API
- `manager/` — lifecycle + phase coordination for the registered set

## Adding a new controller

1. Write the file; self-register at the end of the IIFE via `metaControllerRegistry.register(spec)`
2. Require it from this directory's `index.js` in load order (watchdogs after targets)
3. Declare every bias registration range in `bias-bounds-manifest.json`
4. Re-snapshot: `node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds`

See [doc/TUNING_MAP.md](../../../../doc/TUNING_MAP.md) for the axis ↔ controller mapping.

<!-- HME-DIR-INTENT
rules:
  - "Controllers self-register at load time via `metaControllerRegistry.register()` — never manually wire a controller elsewhere"
  - "Every bias registration must declare its `[lo, hi]` range; unregistered biases are rejected by check-hypermeta-jurisdiction.js"
  - "Watchdog controllers must load AFTER the controllers they observe — preserve order in index.js"
  - "Never compute a bias value outside the [lo, hi] range — if the range is too tight, fix the manifest, don't clamp silently"
  - "`coherentThresholdScale` is owned by the regime self-balancer here; never override it from profiles or callers"
-->
