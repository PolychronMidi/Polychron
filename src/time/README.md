# time

Timing infrastructure — LayerManager, BPM/meter/unit-timing setters, polyrhythm pairs, L0 channel definitions, tempo feel engine, and fractal arc generation. Everything that gives a beat its position in time lives here.

`LayerManager` owns the L1/L2 alternation and per-layer state. Its `perLayerState` map (crossModulation, balOffset, sideBias, lBal, rBal, cBal, cBal2, cBal3, refVar, bassVar, flipBin) is saved and restored on every `activate()` call. Any new mutable global written per-beat and read by both layers must be added to `perLayerState` — otherwise it bleeds between activations.

`l0Channels.js` is the authoritative registry for all L0 channel names. New channels are declared here first, then referenced via `L0_CHANNELS.xxx` everywhere else. Bare strings in L0 method calls are a lint error (`local/no-bare-l0-channel`).

`quantumState` (L1 writes lastPitchClass/lastDensity/lastRegime/lastTexture; L2 reads) is the L2 pre-constraint mechanism — treat it as an internal LayerManager concern.

<!-- HME-DIR-INTENT
rules:
  - New per-beat mutable globals read by both layers must be added to LM.perLayerState — omit and they bleed across L1/L2 activations
  - New L0 channels are declared in l0Channels.js first, then referenced as L0_CHANNELS.xxx — bare strings are a lint error
-->
