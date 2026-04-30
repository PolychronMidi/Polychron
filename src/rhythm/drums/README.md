# rhythm/drums

Drum pattern generation and texture coupling. `drumMap` loads before `drummer` — dependency order is strict. `drumTextureCoupler` exposes `getMetrics()` which `motifManager` reads via `conductorConfig.getMotifTextureClampParams()` — never read `drumTextureCoupler` directly from motif modules (see `composers/motif/` rules).

`drummerCoupleVelocityRange()` blends velocity ranges at a fixed 52/48 anchor ratio. This ratio is co-designed with the accent pattern in `drummer()` — changing it in isolation shifts perceived groove weight.

`playDrums2` is an alternate pattern generator that coexists with `playDrums`. Both register separately; callers select via the registry. Never call either directly — route through `RhythmManager`.

`drumKitRotator` rotates drum-name selection per phrase. Without it, `playDrums`/`playDrums2` would hardcode literal names (`'kick1','kick3'`, etc.) and the listener would hear the same kit forever — leaving cymbals/congas in `drumMap` essentially dead. The rotator keys on `sectionIndex * 11 + phraseIndex * 3` — multipliers chosen coprime with all four family sizes (4, 5, 7, 8) so every phrase rotates every family. L1 uses slots 0..2 by default; L2 uses slots 1..3 so the two layers always pick distinct drums within the same phrase. Must load before `playDrums`/`playDrums2`.

<!-- HME-DIR-INTENT
rules:
  - drumMap must load before drummer — dependency order in index.js is strict
  - drumKitRotator must load before playDrums/playDrums2 — they depend on its global
  - drumTextureCoupler is read by motifManager through conductorConfig only — never import it directly from composers/motif
-->
