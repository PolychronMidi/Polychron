# crossLayer/dynamics

Per-beat dynamic arc coordination — velocity envelopes, articulation complement, dynamic role swaps, rest synchronization, textural mirroring, velocity interference, and convergence surge. All modules write per-layer state and must respect Layer Isolation rules.

Any module here that maintains mutable state written per-beat and read by both layers **must** key that state by `LM.activeLayer` via a closure-based `byLayer` map. `crossLayerDynamicEnvelope` does this correctly — use it as the pattern. Shared state that bleeds across layers produces incoherent envelopes that manifest as audible phase artifacts.

Emission goes through `crossLayerEmissionGateway.emit()` — the parent `crossLayer/` rules apply in full here.

<!-- HME-DIR-INTENT
rules:
  - Per-beat mutable state must be keyed by LM.activeLayer via byLayer map — shared state bleeds across layers and produces audible phase artifacts
  - Emission goes through crossLayerEmissionGateway.emit() — no direct buffer pushes
-->
