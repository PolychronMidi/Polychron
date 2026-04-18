# crossLayer/harmony

Cross-layer harmonic coordination — consonance/dissonance steering, cadence alignment, interval guarding, motif echo, pitch memory recall, register collision avoidance, spectral complementarity, and vertical interval monitoring.

`harmonicIntervalGuard` is the steering authority for consonance/dissonance balance. It nudges note selection toward or away from interval classes based on intent — it never forces a pitch and never writes notes directly. If you need to strengthen its influence, adjust its bias weight through `conductorIntelligence`; don't add direct note mutations here.

`motifIdentityMemory` tracks motif identity across layers — it must be read-only from composers; composers express motif preference through voicing intent, not by writing to this store.

<!-- HME-DIR-INTENT
rules:
  - harmonicIntervalGuard nudges only — never forces pitches or writes notes directly; strengthen via bias weight, not direct mutation
  - motifIdentityMemory is read-only from composers; motif preferences expressed through voicing intent, not direct writes
-->
