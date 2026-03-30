# Subsystem Detail

Module-level reference for each Polychron subsystem.

## `src/utils/` — Shared Foundation (18 files)

- **`validator`** — Stamped validation: `requireFinite`, `optionalFinite`, `requireDefined`, `assertRange`
- **`clamps`** — Numeric clamping
- **`randoms`** — Deterministic random sources (no `Math.random`)
- **`midiData`** — MIDI constants, note names, velocity tables
- **`modeQualityMap`** / **`priorsHelpers`** — Shared priors infrastructure
- **`moduleLifecycle`** — Scoped-reset registry (scopes: `all`/`section`/`phrase`)
- **`beatCache`** — Deduplication: at most one evaluation per beat
- **`feedbackRegistry`** — Coordinates closed-loop controllers against resonance
- **`closedLoopController`** — Base controller abstraction for feedback-enrolled modules
- **`eventCatalog`** — Canonical event type constants
- **`trustSystems`** — Canonical trust system name constants (9 scored, 13 heat-map)

## `src/conductor/` — Intelligence & Signal (127 files, 10 subdirs)

42 modules register with `conductorIntelligence`, contributing 30 density biases, 20 tension biases, 14 flicker modifiers, 29 recorders, 56 state providers.

**Orchestration:** `conductorIntelligence` (registry), `globalConductor` / `globalConductorUpdate` (per-beat), `conductorState` (committed signals), `conductorDampening` (regime-aware gravity + centroid), `dynamismEngine` / `dynamismPulse`, `PhraseArcManager`, `textureBlender`, `config` (central constants), `sectionMemory` (cross-section narrative)

**Domains:** dynamics (8), harmonic (17), melodic (15), rhythmic (15), texture (20), signal (21 + meta-controllers), journey (5), profiles (15)

## `src/rhythm/` — Pattern Generation (20 files)

`RhythmManager`, `rhythmRegistry`, pattern resolution, onset generation, modulation, phase-locked generation, cross-modulation. Subdirs: `drums/` (6), `feedback/` (7).

## `src/time/` — Temporal Infrastructure (13 files)

- **`absoluteTimeGrid`** (L0) — shared temporal memory: `post()`, `query()`, `findClosest()`
- **`LayerManager`** — L1/L2 registration, timing, buffer management
- **`midiTiming`** — tick/time conversion with sync factor for non-power-of-2 meters
- **`getMeterPair`** / **`getPolyrhythm`** — meter pair selection, polyrhythm ratios
- **`tempoFeelEngine`** — tempo humanization via spBeat scaling
- **`setUnitTiming`** — per-unit timing computation

## `src/composers/` — Music Generation (22 files, 6 subdirs)

11 composers: ScaleComposer, ModeComposer, BluesComposer, ChromaticComposer, PentatonicComposer, QuartalComposer, HarmonicRhythmComposer, MelodicDevelopmentComposer, ModalInterchangeComposer, TensionReleaseComposer, VoiceLeadingComposer

**Subdirs:** chord/ (12 — ChordComposer, progressions, harmonic priors), factory/ (7 — FactoryManager, family selection), motif/ (18 — motif transforms, chain, validation), profiles/ (18 — per-composer tuning), voice/ (17 — voice leading scoring, priors, register biasing)

## `src/fx/` — Effects (3 files, 2 subdirs)

- **`setBinaural`** — binaural beat mapping (alpha range 8-12Hz only, grandFinale post-loop walk)
- **`setBalanceAndFX`** — layer balance, panning, FX routing
- **noise/** (7) — simplex/FBM/worley noise engines
- **stutter/** (13) — StutterManager, fade/pan/FX strategies, stutter config/profiler

## `src/crossLayer/` — Layer Coordination (44 files, 5 subdirs)

**Infrastructure:** `crossLayerRegistry`, `crossLayerLifecycleManager`, `conductorSignalBridge` (firewall), `explainabilityBus`, `crossLayerEmissionGateway`

**dynamics/** (6) — articulationComplement, dynamicEnvelope, roleSwap, restSynchronizer, texturalMirror, velocityInterference

**harmony/** (10) — cadenceAlignment, convergenceHarmonicTrigger, harmonicIntervalGuard, motifEcho, motifIdentityMemory, phaseAwareCadenceWindow, registerCollisionAvoider, spectralComplementarity, verticalIntervalMonitor

**rhythm/** (9) — convergenceDetector, emergentDownbeat, feedbackOscillator, grooveTransfer, polyrhythmicPhasePredictor, rhythmicComplementEngine, rhythmicPhaseLock, stutterContagion, temporalGravity

**structure/** (10) — adaptiveTrustScores, beatInterleavedProcessor, contextualTrust, climaxEngine, silhouette, entropyMetrics, entropyRegulator, interactionHeatMap, negotiationEngine, sectionIntentCurves

## `src/writer/` — Output (4 files)

`grandFinale` (CSV finalization + all-sound-off cutoff), `traceDrain` (JSONL trace), `logUnit`

## `src/play/` — Execution Loop (16 files)

`main` (entry point), `fullBootstrap` / `mainBootstrap` (validation), `layerPass` (measure/beat/div loop), `processBeat` (14-stage pipeline), `playNotes` / `playNotesEmitPick` (emission), `crossLayerBeatRecord` (post-beat), `channelCoherence`, `microUnitAttenuator`
