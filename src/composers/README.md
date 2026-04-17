# Composers

Note-producing modules. Each composer takes a beat context, consults trust/regime state, and emits zero or more notes through the cross-layer emission gateway. Composers live in a loose hierarchy — measure-level orchestration (`MeasureComposer`) drives note-level choices (`ChromaticComposer`, `PentatonicComposer`, `ModeComposer`, etc.), which may in turn consult sub-composer utilities (`voice/`, `chord/`, `motif/`).

Composers are **consumers** of conductor signals, never producers. They never mutate conductor state. Emission goes through `crossLayerEmissionGateway.emit(...)` — no direct buffer writes.

## Layout

- `MeasureComposer.js` / `HarmonicRhythmComposer.js` — top-level orchestrators invoked per measure/beat
- `<Style>Composer.js` — scale/mode-style producers (`ChromaticComposer`, `PentatonicComposer`, `ModeComposer`, `ModalInterchangeComposer`, `QuartalComposer`, `BluesComposer`)
- `voice/` — per-voice note selection + voice-leading
- `chord/` — chord quality selection + voicing
- `motif/` — motif tracking, quote detection, development
- `factory/` — composer instantiation + profile binding
- `profiles/` — style profiles (blues, modal, etc.) that bind composer parameter sets
- `intervalComposer.js` / `ScaleComposer.js` / `TensionReleaseComposer.js` / `MelodicDevelopmentComposer.js` — auxiliary selectors

## Adding a composer

1. Self-register via the composer registry at file load
2. Implement the composer capability surface from `composerCapabilities.js`
3. All randomness must go through the validator-stamped RNG (never `Math.random()` directly — `no-math-random` enforces)
4. Require from the subsystem `index.js`; no module requires outside of index

<!-- HME-DIR-INTENT
rules:
  - Composers are consumers of conductor signals, never producers — no mutation of conductor state anywhere in this subtree
  - Note emission goes through `crossLayerEmissionGateway.emit(...)` — direct buffer pushes are blocked by `local/no-direct-buffer-push-from-crosslayer`
  - All randomness goes through the validator-stamped RNG; `Math.random()` is a lint error (`local/no-math-random`)
  - Composers self-register at load time; wire new composers by requiring from this dir's `index.js`, not from random consumers
-->
