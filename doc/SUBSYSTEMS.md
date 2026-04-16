# Subsystem Detail

Module-level reference for each Polychron subsystem. 487 source files, 58K LOC.

## `src/utils/` -- Shared Foundation (35 files)

- **`validator`** -- Stamped validation: `requireFinite`, `optionalFinite`, `requireDefined`, `assertRange`
- **`clamps`** -- Numeric clamping (`clamp`, `modClamp`, `fuzzyClamp`)
- **`randoms`** -- Deterministic random sources (`rf`, `ri`, `rv`, `rl`, `ra`). No `Math.random` directly.
- **`midiData`** -- MIDI constants, note names, velocity tables
- **`modeQualityMap`** / **`priorsHelpers`** -- Shared priors infrastructure
- **`moduleLifecycle`** -- Scoped-reset registry (scopes: `all`/`section`/`phrase`)
- **`beatCache`** -- Layer-aware per-beat memoization (includes `LM.activeLayer` in cache key)
- **`feedbackRegistry`** -- Coordinates closed-loop controllers against resonance
- **`closedLoopController`** -- Base controller abstraction for feedback-enrolled modules
- **`eventCatalog`** -- Canonical event type constants
- **`trustSystems`** -- Canonical trust system name constants (27 scored, 13 heat-map)
- **`musicalTimeWindows`** -- Converts musical seconds to tick/beat counts based on current tempo
- **`safePreBoot`** -- Safe function calls during boot before dependencies are ready
- **`formatTime`** -- Time formatting utilities

## `src/conductor/` -- Intelligence & Signal (193 files, 10 subdirs)

34 modules register recorders with `conductorIntelligence`. All recorders tick L1-only (L2 gated at registry level except `conductorSignalBridge`).

**Orchestration:** `conductorIntelligence` (registry), `globalConductor` / `globalConductorUpdate` (per-beat), `conductorState` (committed signals), `conductorDampening` (regime-aware gravity + centroid), `dynamismEngine` (play/stutter probability resolution with emission gap correction), `PhraseArcManager` (feedback-reactive arc type selection), `textureBlender`, `config` (central constants), `sectionMemory` (cross-section narrative with tension/density trajectory tracking)

**Domains:** dynamics (8 -- peakMemory, momentumTracker, waveAnalyzer, rangeTracker, architectPlanner), harmonic (17), melodic (15), rhythmic (15), texture (20), signal (21 + 19 meta-controllers), journey (5), profiles (15 -- 6 profiles with tuning overrides)

## `src/rhythm/` -- Pattern Generation (22 files)

`RhythmManager`, `rhythmRegistry`, pattern resolution (`binary`, `hex`, `euclid`, `onsets`, `random`, `morph`, `rotate`), onset generation, modulation, phase-locked generation, cross-modulation.

**drums/** (6) -- playDrums, drummer, drumTextureCoupler

**feedback/** (7) -- stutterFeedbackListener (per-layer accumulation), fXFeedbackListener, emissionFeedbackListener (per-layer ratio/gap), journeyRhythmCoupler (per-layer boldness), conductorRegulationListener, rhythmHistoryTracker

## `src/time/` -- Temporal Infrastructure (13 files)

- **`L0`** (L0) -- shared temporal memory: `post()`, `query()`, `findClosest()`, `count()`
- **`l0Channels`** -- canonical L0 channel name registry (`L0_CHANNELS` global, 41 channels). All L0 calls must use `L0_CHANNELS.xxx` — ESLint `no-bare-l0-channel` enforces this
- **`LayerManager`** -- L1/L2 registration, timing, buffer management, per-layer state (`perLayerState` with flipBin), save/restore on `activate()`, PRNG decorrelation
- **`midiTiming`** -- tick/time conversion with sync factor
- **`getMeterPair`** / **`getPolyrhythm`** -- meter pair selection, polyrhythm ratios
- **`tempoFeelEngine`** -- tempo humanization (phase-aware + rubato + stutter tempo feel modulation)
- **`setUnitTiming`** -- per-unit timing computation
- **`timeStream`** -- normalized progress tracking (section/phrase/beat positions)

## `src/composers/` -- Music Generation (24 files, 6 subdirs)

11 composers: ScaleComposer, ModeComposer, BluesComposer, ChromaticComposer, PentatonicComposer, QuartalComposer, HarmonicRhythmComposer, MelodicDevelopmentComposer, ModalInterchangeComposer, TensionReleaseComposer, VoiceLeadingComposer

**factory/** (7) -- FactoryManager, family selection (trust ecology + section trend biases)
**motif/** (18) -- motif transforms, chain, validation
**profiles/** (18) -- per-composer tuning
**voice/** (17) -- voice leading scoring, coherence-responsive independence (phase lock -> counterpoint)

## `src/fx/` -- Effects (55 files, 2 subdirs)

- **`setBinaural`** -- binaural beat mapping (alpha 8-12Hz, grandFinale post-loop walk only). Pitch bend completes within crossfade window. Per-layer flipBin via `LM.perLayerState`. `flipBinCrossfadeWindow` global for stereoScatter.
- **`setBalanceAndFX`** -- per-layer balance (via LM.perLayerState), FX routing, trust/regime-driven instrument selection
- **noise/** (7) -- simplex/FBM/worley/ridged noise engines
- **stutter/** (37) -- StutterManager, 19 variants, stutterVariants (12-dimension selection), stutterSteps (Euclidean+probabilistic gating), stutterNotes (velocity contour, coherence cross-mod), fade/pan/FX CC strategies, config, metrics, channels, plans, registry

## `src/crossLayer/` -- Layer Coordination (58 files, 5 subdirs)

45 registered modules. CIM manages 12 module-pair coordination dials.

**Infrastructure:** `crossLayerRegistry`, `crossLayerLifecycleManager`, `conductorSignalBridge` (firewall + hypermeta state), `explainabilityBus`, `crossLayerEmissionGateway`, `coordinationIndependenceManager` (CIM)

**dynamics/** (7) -- articulationComplement (CIM-aware), dynamicEnvelope (per-layer arcType), roleSwap, restSynchronizer (CIM + density-gated fill), texturalMirror, velocityInterference (CIM + convergence surge), convergenceVelocitySurge

**harmony/** (10) -- cadenceAlignment, convergenceHarmonicTrigger, harmonicIntervalGuard (CIM-aware), motifEcho, motifIdentityMemory, phaseAwareCadenceWindow, registerCollisionAvoider (CIM-aware), spectralComplementarity (CIM + dissonance-scaled), verticalIntervalMonitor

**rhythm/** (11) -- convergenceDetector (CIM-aware), convergenceMemory, emergentDownbeat (tempo multiplier + CIM layer-swap), feedbackOscillator (CIM damping), grooveTransfer (CIM-aware), polyrhythmicPhasePredictor, rhythmicComplementEngine (CIM mode dwell + intent-aware canon bias), rhythmicPhaseLock (CIM-aware), stutterContagion (CIM decay + ghost-stutter contagion), stutterTempoFeel (per-layer EMA), temporalGravity (CIM-aware)

**structure/** (12) -- adaptiveTrustScores (CIM exploration nudge), trustEcologyCharacter (dominance -> composer bias), trustTimbreMapping (dominance -> instrument pools), climaxEngine, silhouette, entropyMetrics, entropyRegulator (phase-gated arc target), interactionHeatMap, negotiationEngine (CIM convergence floor), sectionIntentCurves (trajectory correction, harmonic gravity, intent-aware phase gate)

## `src/writer/` -- Output (4 files)

`grandFinale` (CSV finalization + all-sound-off cutoff + runtime snapshots + adaptive state persistence), `traceDrain` (JSONL trace), `logUnit`

## `src/play/` -- Execution Loop (18 files)

`main` (entry point), `fullBootstrap` / `mainBootstrap` (validation + feedbackGraphContract), `layerPass` (measure/beat/div loop), `processBeat` (conductor + crossLayer orchestration), `playNotes` / `playNotesEmitPick` (emission with convergence surge, stutter echo gate, per-layer channel cache), `crossLayerBeatRecord` (CIM tick, trust ecology, convergence memory, stutter contagion, feedback oscillator, 27 trust registrations), `channelCoherence`, `microUnitAttenuator`
