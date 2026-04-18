# crossLayer/rhythm

Cross-layer rhythmic interaction — convergence detection, emergent downbeat, groove transfer, rhythmic complement, phase lock, stutter contagion, temporal gravity, and polyrhythmic phase prediction.

`stutterTempoFeel` and `stutterContagion` carry per-layer closure state keyed by `LM.activeLayer`. Any new module that tracks per-beat rhythmic state across both layers needs the same treatment — a bare module-level variable will bleed between L1 and L2 activations.

`convergenceDetector` feeds `convergenceMemory`, which in turn gates `stutterContagion` decay rates (`ALIGNED_DECAY=0.35` vs `DIVERGED_DECAY=0.8`). Never read `convergenceMemory` from outside this dir — convergence state is an internal rhythm-layer concept; expose it only via the registered bias surface.

<!-- HME-DIR-INTENT
rules:
  - Per-beat state in new modules must be closure-keyed by LM.activeLayer — bare module-level variables bleed between L1/L2 activations
  - convergenceMemory is internal to this dir — expose convergence state via bias registration, not direct reads from outside
-->
