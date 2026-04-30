# rhythm/drums

Drum pattern generation and texture coupling. `drumMap` loads before `drummer` — dependency order is strict. `drumTextureCoupler` exposes `getMetrics()` which `motifManager` reads via `conductorConfig.getMotifTextureClampParams()` — never read `drumTextureCoupler` directly from motif modules (see `composers/motif/` rules).

`drummerCoupleVelocityRange()` blends velocity ranges at a fixed 52/48 anchor ratio. This ratio is co-designed with the accent pattern in `drummer()` — changing it in isolation shifts perceived groove weight.

`playDrums2` is an alternate pattern generator that coexists with `playDrums`. Both register separately; callers select via the registry. Never call either directly — route through `RhythmManager`.

`drumKitRotator` rotates a 4-preset kit per phrase. Each preset preserves the foundational dominant drums — `kick1+kick3` for L1 (loudest 111-127 / 99-111 velocity ranges), `kick2+kick5+kick7` for L2 — and varies only the supplementary slots: alt-kick fill identity, mix-fill secondary drums, tail-snare, end-accent snare, and the cymbal/conga that flavors the phrase. mixFill always leads with a foundational snare (`snare1`/`snare4` for L1; `snare2`/`snare3` for L2). Both preset and per-slot drum identity advance every phrase via `sectionIndex*11 + phraseIndex*3` (multipliers coprime with the 4-preset cycle). Must load before `playDrums`/`playDrums2`.

**Flair mode.** `getL1Preset(flair)` / `getL2Preset(flair)` accept a flag. When true, the index hash also incorporates `measureIndex*5 + beatIndex*2` so the preset advances every beat (16x faster than per-phrase). `playDrums`/`playDrums2` roll `rf() < 0.12` per beat, so roughly 1-2 of 16 beats use the flair preset and the rest stay grounded. The foundation invariant holds in both modes — every preset still anchors on the dominant kicks/snares.

<!-- HME-DIR-INTENT
rules:
  - drumMap must load before drummer — dependency order in index.js is strict
  - drumKitRotator must load before playDrums/playDrums2 — they depend on its global
  - drumTextureCoupler is read by motifManager through conductorConfig only — never import it directly from composers/motif
-->
