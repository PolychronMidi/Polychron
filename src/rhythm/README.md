# rhythm

Rhythm generation subsystem. `RhythmManager` is the single hub — pattern generation, onset construction, rhythm modulation, and phase-locked generation all route through it. The drum subsystem (`drums/`) loads after `RhythmManager` in `index.js` because it depends on rhythm globals being initialized.

`rhythmMethods` is populated at the bottom of `index.js` as a legacy naked-global alias (`rhythmMethods = rhythmRegistry.getAll()`). Never reassign it elsewhere — consumers that pre-date `RhythmManager` still read it directly, and a reassignment silently breaks them.

## Adding a rhythm generator

Self-register at file load via `rhythmRegistry.register(name, fn)`. Require from `index.js` only — no consumer outside this dir should require a generator directly. The `rhythmMethods` alias updates automatically.

<!-- HME-DIR-INTENT
rules:
  - Never reassign the `rhythmMethods` global — it is populated once at the bottom of index.js; reassignment silently breaks pre-RhythmManager consumers
  - Drum subsystem loads AFTER RhythmManager in index.js; never reorder — drums depend on rhythm globals being initialized
-->
