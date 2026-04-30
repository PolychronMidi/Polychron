# rhythm

Rhythm generation subsystem. `RhythmManager` is the single hub — pattern generation, onset construction, rhythm modulation, and phase-locked generation all route through it. The drum subsystem (`drums/`) loads after `RhythmManager` in `index.js` because it depends on rhythm globals being initialized.

`rhythmMethods` is populated at the bottom of `index.js` as a legacy naked-global alias (`rhythmMethods = rhythmRegistry.getAll()`). Never reassign it elsewhere — consumers that pre-date `RhythmManager` still read it directly, and a reassignment silently breaks them.

`setRhythm` rotates the random-fallback density per phrase via `PHRASE_DENSITY_FACTORS = [0.92, 1.00, 1.05, 1.10]`, hashed from `sectionIndex*7 + phraseIndex*3` (multipliers coprime with the 4-factor cycle). Foundation densities `.4/.3/.3` for div/subdiv/subsubdiv are preserved as the average. ~5% of calls add a one-shot flair multiplier in `[0.85, 1.20]` for occasional touches of variety. The pre-existing `clamp(_, 0.1, 0.9)` guards still wrap every density so the floor/ceiling can't be breached.

`rhythmValues.swingOffset` adds a small jitter on ~10% of calls so swing reads as human rather than mechanical. The jitter magnitude is bounded to `amount/4`, which guarantees the swing direction never inverts (odd beat stays positive, even beat stays negative).

## Adding a rhythm generator

Self-register at file load via `rhythmRegistry.register(name, fn)`. Require from `index.js` only — no consumer outside this dir should require a generator directly. The `rhythmMethods` alias updates automatically.

<!-- HME-DIR-INTENT
rules:
  - Never reassign the `rhythmMethods` global — it is populated once at the bottom of index.js; reassignment silently breaks pre-RhythmManager consumers
  - Drum subsystem loads AFTER RhythmManager in index.js; never reorder — drums depend on rhythm globals being initialized
-->
