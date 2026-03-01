# Polychron

A generative polyrhythmic MIDI composition engine. Two independent metric layers evolve simultaneously, coordinated by cross-layer intelligence and a conductor system. Music emerges through **emergent coherence** — 100+ independent observers nudge a shared signal field, and complex feedback loops resolve contradictions into musicality.

## Table of Contents

- [Getting Started](#getting-started)
- [Architecture Overview](#architecture-overview)
- [Subsystem Map](#subsystem-map)
- [Signal & Feedback Topology](#signal--feedback-topology)
- [Conductor Intelligence](#conductor-intelligence)
- [Cross-Layer Coordination](#cross-layer-coordination)
- [Composers & Music Generation](#composers--music-generation)
- [Diagnostic & Telemetry](#diagnostic--telemetry)
- [Configuration & Profiles](#configuration--profiles)
- [Build Pipeline](#build-pipeline)
- [Custom ESLint Rules](#custom-eslint-rules)
- [Output Files](#output-files)
- [Music21 & Priors](#music21--priors)
- [Documentation Index](#documentation-index)

## Getting Started

### Prerequisites

- Node.js (CommonJS)
- Python 3 (for Music21 priors scripts only)

### Install

```bash
npm install
```

### Run

```bash
npm run main
```

This single command runs the full 14-stage pipeline: global generation, boot-order verification, tuning invariant checks, linting, type-checking, composition, trace summary, health check, dependency graph, conductor map, cross-layer map, golden fingerprint, narrative digest, and feedback graph visualization. Output lands in `output/`, logs in `log/`.

Pass `--seed N` to make composition deterministic (seeded PRNG via mulberry32 replaces `Math.random`):

```bash
npm run main -- --seed 42
```

### Dependencies

- **`tonal`** (^6.4.2) — Music theory library — scales, chords, intervals, note math
- **`@tonaljs/rhythm-pattern`** (^1.0.0) — Rhythm pattern generation

TypeScript (^5.9.3), ESLint (^9.0.0), and related tooling are dev dependencies. Type-checking is via `tsc --noEmit` over JSDoc-annotated JavaScript.

## Architecture Overview

Polychron does not hardcode musical structure — it steers it. The system generates compositions through a three-layer nervous system:

**Conductor** — 42 intelligence modules cast multiplicative bias votes for density, tension, and flicker. Products are dampened, normalized, and committed to state. `signalReader` is the ONE read API for all consumers.

  v getSignals() / signalReader.*()          ^ explainabilityBus (diagnostic only)

**Cross-Layer** — 44 modules coordinate L1-L2 via `absoluteTimeGrid` (shared temporal memory), `negotiationEngine` (trust-weighted conflict arbiter), `entropyRegulator` (meta-conductor entropy steering), `adaptiveTrustScores` (per-module EMA weights 0.4-1.8), and `explainabilityBus` (ring buffer of typed diagnostics).

  v modified playProb/stutterProb            ^ NOTES_EMITTED, STUTTER_APPLIED

**Play Loop** — section, phrase, measure, beat, div, subdiv, subsubdiv. `processBeat` orchestrates cross-layer, emits notes, records. `coherenceMonitor` feeds closed-loop density feedback back to the conductor.

### The Beat Lifecycle

Every beat follows this sequence:

1. **Conductor update** — `globalConductorUpdate` collects intelligence module votes, computes composite intensity, applies dampening (`conductorDampening`) and normalization (`pipelineNormalizer`), commits resolved signals to `conductorState`.
2. **Signal bridge** — `conductorSignalBridge` caches a beat-delayed snapshot. Cross-layer modules read through this bridge, never directly from the conductor. This firewall prevents microscopic layer interplay from polluting macroscopic composition trajectories.
3. **Play loop** — `processBeat` orchestrates a 14-stage topological pipeline: binaural mapping, intent curves, entropy regulation, phase lock, rest sync, cadence probing, negotiation, probability adjust, note emission, and beat recording.
4. **Negotiation** — `negotiationEngine` applies `adaptiveTrustScores` weights (0.4–1.8) to cross-layer module recommendations, forcing consensus through compromise.
5. **Emission** — Notes are picked via the assigned composer, stutter effects apply, MIDI/CSV events push to the buffer.
6. **Closing the loop** — `crossLayerBeatRecord` captures output, `coherenceMonitor` compares actual vs intended density and feeds a dampened bias correction back to the conductor for the next beat.

For a deep-dive, see [ARCHITECTURE.md](ARCHITECTURE.md).

### Emergence Boundaries

Three firewalls keep the system musical instead of chaotic:

- **Top-down steering only** — The conductor sets the climate. Cross-layer orchestrates the weather. The play loop experiences it. Cross-layer modules cannot write to the conductor; they modify `playProb`/`stutterProb` locally and emit diagnostics to `explainabilityBus`. Conversely, conductor modules cannot mutate cross-layer state (ESLint-enforced).
- **Network dampening** — Every feedback loop must register with `feedbackRegistry`. The closed-loop controller mechanism prevents phase misalignment and thermal loads from causing resonance.
- **Temporal decoupling** — Modules communicate via `absoluteTimeGrid` channels (`post()` / `query()` / `findClosest()` by millisecond time), not direct calls.

### Load Order

`src/index.js` requires subsystems in this exact, dependency-driven order:

```
utils - conductor - rhythm - time - composers - fx - crossLayer - writer - play
```

Each subsystem's `index.js` loads helpers first, then the manager/orchestrator last.

## Subsystem Map

### `src/utils/` — Shared Foundation (16 files)

Core infrastructure consumed by every other subsystem.

- **`validator`** — Stamped validation — `requireFinite`, `optionalFinite`, `requireDefined`, `assertRange`, etc.
- **`clamps`** — Numeric clamping utilities
- **`randoms`** — Deterministic random sources (no `Math.random` — ESLint-enforced)
- **`midiData`** — MIDI constants, note names, velocity tables
- **`instrumentation`** — Runtime instrumentation and timing
- **`modeQualityMap`** — Canonical mode-to-quality map shared by priors modules
- **`priorsHelpers`** — `resolvePhase`, `resolveWeightOrDefault`, `weightedAdjustment`
- **`moduleLifecycle`** — Scoped-reset registry (`create(ownerName)` → reset by scope: `all`/`section`/`phrase`)
- **`beatCache`** — Deduplication — `create(fn)` ensures at most one evaluation per beat
- **`feedbackRegistry`** — Coordinates closed-loop controllers to prevent catastrophic resonance
- **`closedLoopController`** — Base controller abstraction for feedback-enrolled modules
- **`eventCatalog`** — Canonical event type constants
- **`systemSnapshot`** — Serializable state capture for diagnostics
- **`formatTime`** — Time formatting utilities
- **`init`** — Bootstrap initialization side-effects

### `src/conductor/` — Intelligence & Signal (127 files across 10 subdirectories)

The brainof the system. 42 modules register with `conductorIntelligence`, contributing 29 density biases, 19 tension biases, 14 flicker modifiers, 29 recorders, and 56 state providers. Organized into specialized domains:

**Top-level orchestration:**

- **`conductorIntelligence`** — Central registry — `registerDensityBias`, `registerTensionBias`, `registerFlickerModifier`, `registerRecorder`, `registerStateProvider`, `registerModule`
- **`globalConductor`** — Orchestrates system-wide coherence — motif density, stutter, play probabilities
- **`globalConductorUpdate`** — Per-beat collection of all registered bias products
- **`conductorState`** — Committed signal state snapshot
- **`conductorDampening`** — Progressive deviation dampening — regime-aware gravity + dimensionality-aware strength
- **`dynamismEngine`** / **`dynamismPulse`** — Dynamic energy tracking and pulse detection
- **`PhraseArcManager`** / **`phraseArcProfiler`** — Phrase-level arc shaping (attack/sustain/release)
- **`textureBlender`** — Blends texture signals across layers
- **`config`** — Central tunable constants — sections, phrases, divisions, weight distributions
- **`sectionMemory`** — Cross-section narrative memory (snapshot before reset, seed 30% carryover)
- **`analysisHelpers`** — Shared analysis utilities

**Subdomain modules:**

- **`dynamics/`** (8) — Climax prediction, density waves, dynamic range, energy momentum, velocity shape
- **`harmonic/`** (17) — Cadence advising, consonance/dissonance, harmonic density, field tracking, pitch-class gravity, tension resolution, tonal anchor distance
- **`melodic/`** (15) — Ambitus migration, counterpoint motion, interval balance, melodic contour, register migration, tessiture pressure, thematic recall, voice-leading efficiency
- **`rhythmic/`** (15) — Accent patterns, attack density, onset regularity, rhythmic complexity, syncopation density, temporal proportions
- **`texture/`** (20) — Articulation profiling, layer coherence, motivic density, orchestration weight, repetition fatigue, rest density, structural form, textural gradients, voice density
- **`signal/`** (16 + `output/`) — Pipeline infrastructure — see [Diagnostic & Telemetry](#diagnostic--telemetry)
- **`journey/`** (5) — Harmonic journey planning — key/mode selection across sections
- **`profiles/`** (15) — Conductor config profiles (default, minimal, atmospheric, explosive, restrained, rhythmic drive) + merging/validation/tuning

### `src/rhythm/` — Pattern Generation (20 files)

- **`rhythmManager`** — Subsystem manager — pattern lifecycle coordination
- **`rhythmRegistry`** — Pattern and strategy registration
- **`patterns`** / **`getRhythm`** / **`setRhythm`** — Pattern resolution and assignment
- **`makeOnsets`** — Onset generation from patterns
- **`rhythmModulator`** — Real-time pattern modulation
- **`phaseLockedRhythmGenerator`** — Phase-aware rhythm generation for cross-layer sync
- **`crossModulateRhythms`** — Cross-layer rhythm modulation
- **`rhythmPriors`** / **`rhythmPriorsData`** — Musicological rhythm probability tables
- **`rhythmHistoryTracker`** — Pattern usage history
- **`rhythmConfig`** / **`rhythmValues`** / **`patternLength`** — Configuration and constants

**Subdirectories:**
- `drums/` (6 files) — `drumMap`, `drummer`, `drumTextureCoupler`, `playDrums`
- `feedback/` (7 files) — `conductorRegulationListener`, `emissionFeedbackListener`, `feedbackAccumulator`, `fXFeedbackListener`, `journeyRhythmCoupler`, `stutterFeedbackListener`

### `src/time/` — Temporal Infrastructure (13 files)

- **`absoluteTimeGrid`** — Shared temporal memory — `post()` to channels, `query()`/`findClosest()` by ms
- **`absoluteTimeWindow`** — Sliding window over absolute time for recent-history queries
- **`LayerManager`** — Manages L1/L2 layer registration and timing
- **`midiTiming`** — MIDI tick/time conversion
- **`getPolyrhythm`** / **`polyrhythmPairs`** — Polyrhythm ratio computation
- **`getMeterPair`** — Selects meter pairs for sections
- **`tempoFeelEngine`** — Tempo humanization and feel
- **`fractalArcGenerator`** — Fractal-based structural arc generation
- **`setUnitTiming`** — Per-unit timing computation
- **`timeStream`** / **`timeGridHelpers`** — Time streaming and grid utilities

### `src/composers/` — Music Generation (22 files + 6 subdirectories)

Eleven specialized composers, each implementing a distinct compositional strategy:

- **`ScaleComposer`** — Scale-degree-based melodic generation
- **`ModeComposer`** — Modal composition with mode-specific voice leading
- **`BluesComposer`** — Blues scale patterns with blue-note inflections
- **`ChromaticComposer`** — Chromatic passage and passing-tone generation
- **`PentatonicComposer`** — Pentatonic scale patterns
- **`QuartalComposer`** — Quartal/quintal harmony construction
- **`HarmonicRhythmComposer`** — Harmonic rhythm-aware note selection
- **`MelodicDevelopmentComposer`** — Motivic development and transformation
- **`ModalInterchangeComposer`** — Borrowed chords from parallel modes
- **`TensionReleaseComposer`** — Tension/release arc-driven composition
- **`MeasureComposer`** — Measure-level note pool management

**Subdirectories:**
- `chord/` (12 files) — `ChordComposer`, `ChordManager`, `ProgressionGenerator`, harmonic priors
- `factory/` (7 files) — `FactoryManager` — selects and blends composers per phrase, phase-based family affinity
- `motif/` (18 files) — `MotifComposer`, `motifManager`, motif transforms, chain, validation
- `profiles/` (18 files) — Per-composer tuning profiles + `profileRegistry` + `runtimeProfileAdapter`
- `utils/` (4 files) — Scale degree transposition, normalization
- `voice/` (17 files) — `VoiceLeadingComposer`, `VoiceManager`, voice-leading scoring and priors

### `src/fx/` — Effects (3 files + 2 subdirectories)

- **`setBalanceAndFX`** — Layer balance, panning, and FX routing
- **`setBinaural`** — Binaural beat mapping

**Subdirectories:**
- `noise/` (7 files) — `noiseManager`, simplex/FBM/worley noise engines, configuration
- `stutter/` (13 files) — `StutterManager`, stutter fade/pan/FX strategies, stutter config, stutter profiler

### `src/crossLayer/` — Layer Coordination (44 files across 5 subdirectories)

Coordinates the two independent metric layers through trust-weighted negotiation.

**Top-level infrastructure:**

- **`crossLayerRegistry`** — `register(name, module, scopes)` — lifecycle management for cross-layer modules
- **`crossLayerLifecycleManager`** — Orchestrates `resetAll`/`resetSection`/`resetPhrase` across registered modules
- **`conductorSignalBridge`** — Beat-delayed signal cache — the firewall between conductor and cross-layer
- **`explainabilityBus`** — Ring buffer of typed diagnostic events for telemetry

**Subdomain modules:**

- **`dynamics/`** (6) — `articulationComplement`, `crossLayerDynamicEnvelope`, `dynamicRoleSwap`, `restSynchronizer`, `texturalMirror`, `velocityInterference`
- **`harmony/`** (10) — `cadenceAlignment`, `convergenceHarmonicTrigger`, `harmonicIntervalGuard`, `motifEcho`, `motifIdentityMemory`, `phaseAwareCadenceWindow`, `pitchMemoryRecall`, `registerCollisionAvoider`, `spectralComplementarity`, `verticalIntervalMonitor`
- **`rhythm/`** (9) — `convergenceDetector`, `emergentDownbeat`, `feedbackOscillator`, `grooveTransfer`, `polyrhythmicPhasePredictor`, `rhythmicComplementEngine`, `rhythmicPhaseLock`, `stutterContagion`, `temporalGravity`
- **`structure/`** (10) — `adaptiveTrustScores`, `beatInterleavedProcessor`, `contextualTrust`, `crossLayerClimaxEngine`, `crossLayerSilhouette`, `entropyMetrics`, `entropyRegulator`, `interactionHeatMap`, `negotiationEngine`, `sectionIntentCurves`

### `src/writer/` — Output (4 files)

- **`grandFinale`** — Final CSV/MIDI file writing
- **`traceDrain`** — JSONL trace output (`output/trace.jsonl`) when `--trace` is enabled
- **`logUnit`** — Structured per-unit logging

### `src/play/` — Execution Loop (16 files)

The top-level composition engine.

- **`main`** — Entry point — section/phrase/measure orchestration, journey planning, lifecycle management
- **`fullBootstrap`** / **`mainBootstrap`** — Global validation, registry population assertions, `VALIDATED_GLOBALS` + `ADVISORY_GLOBALS` (graduated: critical globals throw on missing, advisory globals warn only — annotate with `/** @boot-advisory */` in `globals.d.ts`)
- **`layerPass`** — Extracted layer pass loop — conductor updates batched once per measure
- **`processBeat`** — Per-beat pipeline — 14-stage topological sequence
- **`events`** — Beat event dispatching
- **`playNotes`** / **`playNotesEmitPick`** / **`playNotesComputeUnit`** — Note emission pipeline
- **`emitPickCrossLayerRecord`** / **`emitPickTextureEmit`** — Post-emission cross-layer recording and texture emission
- **`crossLayerBeatRecord`** — Post-beat outcome recording with trust payoffs
- **`beatPipelineDescriptor`** — Pipeline stage metadata
- **`channelCoherence`** — Channel-level coherence tracking
- **`microUnitAttenuator`** — Sub-beat attenuation for subdivisions

## Signal & Feedback Topology

### Three Signal Pipelines

Each pipeline collects multiplicative bias votes from registered modules:

- **Density** (29 biases) — Controls note output probability
- **Tension** (19 biases) — Shapes harmonic tension and resolution
- **Flicker** (14 modifiers) — Drives rhythmic variation and stutter

All three are dampened + normalized.

Biases are multiplied together (not summed), dampened by `conductorDampening` (regime-aware gravity), normalized by `pipelineNormalizer` (adaptive soft-envelope), and decorrelated by `pipelineCouplingManager` (self-tuning gain nudges when correlation exceeds targets).

### Feedback Loops

Five closed-loop feedback systems maintain compositional coherence:

- **Density correction** (`coherenceMonitor`) — Compares actual vs intended note output; feeds dampened bias (0.60–1.30) into density product. Phase-aware bell gain peaks mid-phrase.
- **Entropy steering** (`entropyRegulator`) — Steers cross-layer systems toward a section-position-driven entropy target. Scale clamp [0.3, 2.0].
- **Condition hints** (`profileAdaptation`) — Detects sustained low-density / high-tension / flat-flicker streaks; advisory hints for `conductorConfig`. Streak trigger at 6 beats.
- **Trust governance** (`adaptiveTrustScores`) — EMA-based weights (0.4–1.8) per cross-layer module. 8 scored systems: `stutterContagion`, `phaseLock`, `cadenceAlignment`, `feedbackOscillator`, `coherenceMonitor`, `convergence`, `entropyRegulator`, `restSynchronizer`.
- **Decorrelation** (`pipelineCouplingManager`) — Self-tuning decorrelation for 6 compositional-dimension pairs. Adaptive gain, regime-aware.

All controllers are enrolled with `feedbackRegistry` to prevent catastrophic resonance.

For constant values, interaction partners, and cross-constant invariants, see [TUNING_MAP.md](TUNING_MAP.md).

### Regime Detection

`systemDynamicsProfiler` classifies the system's 6D phase-space trajectory (density, tension, flicker, entropy, trust, phase) into regimes with 5-beat hysteresis:

- **`exploring`** — High variance, low coherence — the system is searching
- **`coherent`** — Stable, well-correlated signals — everything is working together
- **`evolving`** — Gradual directional change — musical development
- **`drifting`** — Slowly losing coherence — needs nudging
- **`oscillating`** — Periodic instability — feedback loop interference
- **`fragmented`** — Multiple signals pulling in different directions
- **`stagnant`** — Flat signals — musical stasis

Regime classification drives dampening strength, decorrelation aggressiveness, and profile adaptation behavior.

## Conductor Intelligence

### Module Registration

Every conductor intelligence module self-registers at load time via `conductorIntelligence`:

```js
conductorIntelligence.registerDensityBias('myModule', () => bias, lo, hi);
conductorIntelligence.registerRecorder('myModule', (ctx) => { /* side-effect */ });
conductorIntelligence.registerStateProvider('myModule', () => ({ field: value }));
conductorIntelligence.registerModule('myModule', { reset() { /* ... */ } }, ['all', 'section']);
```

### Contribution Flow

1. Module votes (multiplicative biases)
2. `conductorIntelligence` collects products
3. `conductorDampening` limits deviation (regime-aware)
4. `pipelineNormalizer` smooths (adaptive envelope)
5. `pipelineCouplingManager` decorrelates (pair targets)
6. `pipelineBalancer` self-regulates (attribution-driven, deadband 0.25)
7. `conductorState` commits final signals
8. `signalReader` exposes to consumers

### Intelligence Domains

- **Dynamics** (8) — Energy, climax, dynamic range, velocity, density waves
- **Harmonic** (17) — Cadence, consonance, harmonic fields, pitch gravity, tension resolution
- **Melodic** (15) — Contour, intervals, register, tessiture, counterpoint, thematic recall
- **Rhythmic** (15) — Accent, onset, syncopation, complexity, symmetry, temporal proportions
- **Texture** (20) — Articulation, layer coherence, motivic density, rest density, structural form
- **Signal** (16) — Pipeline health, dynamics profiling, coupling, normalization, coherence
- **Journey** (5) — Harmonic journey planning — key/mode selection, harmonic rhythm

## Cross-Layer Coordination

### Trust System

`adaptiveTrustScores` maintains EMA-based trust scores for 8 cross-layer modules:

- **`stutterContagion`** — Cross-layer stutter coordination effectiveness
- **`phaseLock`** — Phase synchronization accuracy
- **`cadenceAlignment`** — Cadence resolution success
- **`feedbackOscillator`** — Feedback stability
- **`coherenceMonitor`** — Density correction accuracy
- **`convergence`** — Layer convergence quality
- **`entropyRegulator`** — Entropy tracking accuracy
- **`restSynchronizer`** — Meaningful shared rest success

Trust formula: `score = score * 0.9 + payoff * 0.1` (EMA). Weight: `1 + score * 0.75`, clamped to [0.4, 1.8]. `negotiationEngine` consumes these weights to gate which systems get influence.

### Negotiation Engine

`negotiationEngine` is the conflict arbiter. It receives intent from multiple cross-layer modules and produces final `playProb` and `stutterProb` for each layer per beat. Trust weights scale each module's influence. Play scale clamped to [0.4, 1.8] — matching trust weight range by design.

### absoluteTimeGrid

Shared temporal memory for inter-module communication:
- `post(channel, time, data)` — write to a named channel at absolute ms time
- `query(channel, startMs, endMs)` — read events in a time range
- `findClosest(channel, targetMs)` — nearest event lookup

Modules never call each other directly; they post to and query from the grid.

## Composers & Music Generation

### Factory System

`FactoryManager` selects and blends composers per phrase based on:
- Phase-based family affinity (exploratory phases favor wider selection)
- Active conductor profile (profiles can bias toward specific composer families)
- Harmonic context (key, mode, chord progression)

Two composers are selected per phrase — one for L1, one for L2 — allowing contrapuntal independence.

### Motif System

The motif subsystem (18 files) provides motivic identity and development:
- `Motif` — immutable motif data structure
- `motifChain` — tracks motif history for thematic continuity
- `motifTransforms` — inversion, retrograde, augmentation, diminution, transposition
- `motifTransformAdvisor` — context-aware transform selection
- `playMotifs` — motif application during note emission

### Voice Leading

`VoiceLeadingComposer` and `VoiceManager` ensure smooth melodic transitions:
- `voiceLeadingScorers` — multi-criteria scoring (interval size, direction, common tones)
- `voiceLeadingPriors` — musicological voice-leading probability tables
- `registerBiasing` — register-aware note selection

### Chord System

`ChordComposer` and `ChordManager` handle harmonic generation:
- `ProgressionGenerator` — generates chord progressions from journey context
- `pivotChordBridge` — smooth modulation between sections via pivot chords
- `harmonicPriors` — musicological chord transition probabilities

## Diagnostic & Telemetry

### Signal Health

- **`signalHealthAnalyzer`** — Per-beat pipeline health grades: `healthy`/`strained`/`stressed`/`critical`
- **`coherenceVerdicts`** — Auto-diagnoses findings (critical/warning/info) from health, dynamics, attribution, trust, coupling
- **`signalTelemetry`** — Signal pipeline telemetry recording

### System Dynamics

- **`systemDynamicsProfiler`** — 6D phase-space regime classification (see [Regime Detection](#regime-detection))
- **`phaseSpaceMath`** — Welford's z-score normalization, derivative metrics
- **`narrativeTrajectory`** — Tracks compositional narrative arc over time
- **`structuralNarrativeAdvisor`** — Structural form advice based on trajectory

### Output Artifacts

- **`output/system-manifest.json`** (JSON) — Machine-readable diagnostic snapshot — config, journey, registries, contributions, health
- **`output/capability-matrix.md`** (Markdown) — Human-readable summary of system capabilities and module registrations
- **`output/trace.jsonl`** (JSONL) — Per-beat trace data (when `--trace` enabled) — full pipeline state per beat
- **`output/trace-summary.json`** (JSON) — Statistical summary of trace (regimes, signals, coupling, trust, stage timing)
- **`output/dependency-graph.json`** (JSON) — Machine-readable global dependency graph
- **`output/conductor-map.json`** + **`conductor-map.md`** — Per-module conductor intelligence map
- **`output/golden-fingerprint.json`** + **`fingerprint-comparison.json`** — Statistical regression detection
- **`output/narrative-digest.md`** (Markdown) — Prose narrative of the composition run

**Use `system-manifest.json` as the primary diagnostic source.**

### Trace System

When `--trace` is passed to `main.js`, `traceDrain` writes a JSONL entry per beat containing:
- Conductor signals (density, tension, flicker)
- Cross-layer module decisions
- Trust scores and payoffs
- Negotiation outcomes
- Note emission details (including embedded per-beat `notes` array with pitch, velocity, channel)
- Pipeline health grades

`scripts/trace-summary.js` processes the trace into a statistical summary after composition, including per-stage timing aggregates (min/max/avg) when stage profiling data is present.

**Trace Replay:** `npm run replay` launches `scripts/trace-replay.js` for post-hoc trace analysis:

```bash
npm run replay -- --timeline          # Beat-by-beat timeline (default)
npm run replay -- --stats              # Per-section/phrase aggregates
npm run replay -- --section 2          # Filter to section 2
npm run replay -- --layer 1            # Filter to layer 1
npm run replay -- --search regime=sparse  # Search for specific values
npm run replay -- --json               # Output as JSON to output/trace-replay.json
```

### Golden Fingerprint

`scripts/golden-fingerprint.js` computes a 7-dimension statistical fingerprint of each composition run (note count, pitch entropy, density variance, tension arc, trust convergence, regime distribution, coupling means). Each run is compared against the previous to detect regression:

- **STABLE** — 0 dimensions drifted
- **EVOLVED** — 1–2 dimensions shifted (normal musical variation)
- **DRIFTED** — 3+ dimensions shifted (potential regression)

A **drift explainer** (`output/fingerprint-drift-explainer.json`) is auto-generated alongside the comparison, providing per-dimension causal analysis: note count correlations, pitch entropy interpretation, density variance significance, tension arc reshaping, trust module shifts, and regime balance changes.

### Narrative Digest

`scripts/narrative-digest.js` generates a prose story of the composition: what the system did, why, and how it felt about it (trust scores, regime transitions, signal landscape).

### Conductor Intelligence Map

`scripts/generate-conductor-map.js` auto-generates a per-module map showing signal reads, bias registrations, domains, scopes, and end-of-run bias values.

### Cross-Layer Intelligence Map

`scripts/generate-crosslayer-map.js` auto-generates a map of all cross-layer modules showing:
- Registry scopes (all/section/phrase)
- ATG channel usage per module
- Inter-module interactions and dependencies
- Output: `output/crosslayer-map.json` + `output/crosslayer-map.md`

### Feedback Graph Visualization

`scripts/visualize-feedback-graph.js` generates an interactive HTML/SVG visualization (`output/feedback-graph.html`) of the feedback topology from `FEEDBACK_GRAPH.json`. Features:
- Circle-layout graph with color-coded edges by latency (immediate/beat/phrase/section)
- Hover tooltips with mechanism details
- Node colors by subsystem, firewall legend, invariant status badge

### Live Dashboard

`npm run dashboard` launches a zero-dependency WebSocket server that streams trace data in real time to a browser dashboard at `http://localhost:3377`. Run it alongside `npm run main` in another terminal.

### Explainability Bus

`explainabilityBus` maintains a ring buffer of typed diagnostic events emitted by cross-layer modules. Used for post-hoc analysis of why specific musical decisions were made.

## Configuration & Profiles

### Conductor Config (`src/conductor/config.js`)

Central hub of tunable constants, annotated with sensitivity tiers:

- **`@tier-1`** — Feedback loop constants (documented in [TUNING_MAP.md](TUNING_MAP.md)). Changing these shifts emergent behavior across multiple subsystems.
- **`@tier-2`** — Musical texture constants. Changes affect timbral quality, rhythmic feel, and harmonic character.
- **`@tier-3`** — Structural defaults and cosmetic settings. Safe to experiment with freely.

- **`SECTIONS`** — Section count range {min: 3, max: 5}
- **`PHRASES_PER_SECTION`** — Phrases per section {min: 1, max: 3}
- **`BPM`** — Tempo (default: 72)
- **`PPQ`** — Pulses per quarter note (30000)
- **`TUNING_FREQ`** — Tuning frequency (432 Hz)
- **`DIVISIONS`** / **`SUBDIVS`** / **`SUBSUBDIVS`** — Beat subdivision weight distributions
- **`BINAURAL`** — Binaural beat configuration
- **`TENSION_SMOOTHING`** — Tension EMA factor (0.25)
- **`FLICKER_SMOOTHING`** — Flicker EMA factor (0.15)

### Conductor Profiles

Six named profiles shape the conductor's behavior:

- **`default`** — Balanced, general-purpose
- **`minimal`** — Sparse, restrained
- **`atmospheric`** — Ambient, texture-focused
- **`explosive`** — High energy, dense
- **`restrained`** — Conservative, steady
- **`rhythmicDrive`** — Rhythm-forward, percussive

Profiles are defined in `src/conductor/profiles/` and resolved by `conductorConfig` with merge/validation/tuning-override support.

### Section Memory

`sectionMemory` provides cross-section narrative continuity:
- `snapshot()` — captures density/tension/flicker/energy/trend before section reset
- `seed()` — blends previous density into new section at 30% carryover
- `getPrevious()` — retrieves previous section snapshot
- `reset()` — clears memory

## Build Pipeline

`npm run main` executes this sequence:

1. `node scripts/generate-globals-dts.js` — Regenerates `VALIDATED_GLOBALS` + `ADVISORY_GLOBALS` from `globals.d.ts`
2. `node scripts/verify-boot-order.js` — Validates subsystem require order, intra-subsystem dependency ordering, and cross-subsystem dependency ordering
3. `node scripts/check-tuning-invariants.js` — Validates cross-constant invariants from [TUNING_MAP.md](TUNING_MAP.md)
4. `npm run lint` — ESLint with 16 custom rules (auto-fix)
5. `npm run tc` — TypeScript type-check via `tsc --noEmit`
6. `node src/play/main.js --trace` — Runs composition (16GB heap, trace enabled)
7. `node scripts/trace-summary.js` — Summarizes trace output
8. `node scripts/check-manifest-health.js` — Validates system manifest health and coupling tail risk
9. `node scripts/generate-dependency-graph.js` — Builds machine-readable dependency graph
10. `node scripts/generate-conductor-map.js` — Auto-generates conductor intelligence map
11. `node scripts/generate-crosslayer-map.js` — Auto-generates cross-layer intelligence map
12. `node scripts/golden-fingerprint.js` — Statistical regression detection (7-dimension fingerprint + drift explainer)
13. `node scripts/narrative-digest.js` — Generates prose narrative of composition run
14. `node scripts/visualize-feedback-graph.js` — Generates interactive feedback graph visualization

All steps log to `log/` via `scripts/run-with-log.js`.

### Other Scripts

- **`npm run dashboard`** — Launch real-time composition dashboard (WebSocket on `:3377`)
- **`npm run replay`** — Trace replay analysis (`--timeline`, `--stats`, `--section N`, `--layer L`, `--search K=V`, `--json`)
- **`npm run snapshot <name>`** — Save current `output/` as a named snapshot for A/B comparison
- **`npm run compare <name>`** — Compare current `output/` against a named snapshot (verdict: SIMILAR/DIFFERENT/DIVERGENT)
- **`npm run diff <name>`** — Structural composition diff against a named snapshot (section/harmonic/tension/regime/pitch changes)
- **`npm run music21-data`** — Run Music21 priors export scripts
- **`npm run lint:raw`** — ESLint without log wrapper
- **`npm run tc`** — TypeScript check only
- **`npm run deps:check`** — Check for unused dependencies
- **`npm run deps:audit`** — Security audit + dep check

## Custom ESLint Rules

16 project-specific rules in `scripts/eslint-rules/`:

- **`case-conventions`** — Enforce PascalCase for classes, camelCase for everything else
- **`no-conductor-registration-from-crosslayer`** — Prevent cross-layer modules from registering with conductor
- **`no-console-acceptable-warning`** — Restrict `console.warn` to `'Acceptable warning: ...'` format
- **`no-direct-conductor-state-from-crosslayer`** — Prevent cross-layer modules from reading `conductorState` directly (must use `conductorSignalBridge`)
- **`no-direct-crosslayer-write-from-conductor`** — Prevent conductor modules from mutating cross-layer state (read-only access allowed)
- **`no-direct-signal-read`** — Ban `conductorIntelligence.getSignalSnapshot()` — use `signalReader`
- **`no-math-random`** — Ban `Math.random()` — use project random sources
- **`no-non-ascii`** — Ban non-ASCII characters in source
- **`no-requires-outside-index`** — Restrict `require()` to `index.js` files
- **`no-silent-early-return`** — Ban silent early returns — fail fast
- **`no-typeof-validated-global`** — Ban `typeof` checks on boot-validated globals
- **`no-unregistered-feedback-loop`** — Require feedback loop registration with `feedbackRegistry` (closedLoopController auto-registers)
- **`no-unstamped-validator`** — Require module name stamp on `validator.create()`
- **`no-useless-expose-dependencies-comments`** — Ban `/* expose-dependencies */` comments
- **`only-error-throws`** — Require `throw new Error(...)` — no throwing strings/objects
- **`validator-name-matches-filename`** — Require validator stamp to match filename

## Output Files

### Composition Output

- **`output/output1.csv`** — Layer 1 MIDI event data (CSV)
- **`output/output1.mid`** — Layer 1 MIDI file
- **`output/output2.csv`** — Layer 2 MIDI event data (CSV)
- **`output/output2.mid`** — Layer 2 MIDI file

### Diagnostic Artifacts

- **`output/system-manifest.json`** — Full diagnostic manifest (config, journey, registries, attribution, verdicts)
- **`output/capability-matrix.md`** — Human-readable capability summary
- **`output/trace.jsonl`** — Per-beat trace data (when `--trace` enabled)
- **`output/trace-summary.json`** — Statistical summary of trace data (regimes, signals, coupling, trust, stage timing)
- **`output/boot-order.json`** — Boot order with per-file global providers, intra-subsystem violations, and cross-subsystem violations
- **`output/tuning-invariants.json`** — Cross-constant invariant validation results

### Analysis Artifacts (generated post-composition)

- **`output/dependency-graph.json`** — Machine-readable global dependency graph (nodes, edges, fan-in/fan-out)
- **`output/conductor-map.json`** — Per-module registry of signals, biases, domains, scopes
- **`output/conductor-map.md`** — Human-readable conductor intelligence map
- **`output/golden-fingerprint.json`** — 7-dimension statistical fingerprint of current run
- **`output/golden-fingerprint.prev.json`** — Previous run fingerprint (for comparison)
- **`output/fingerprint-comparison.json`** — Dimension-by-dimension drift analysis (STABLE/EVOLVED/DRIFTED)
- **`output/fingerprint-drift-explainer.json`** — Per-dimension causal drift analysis
- **`output/crosslayer-map.json`** + **`crosslayer-map.md`** — Cross-layer intelligence map (modules, scopes, ATG channels)
- **`output/feedback-graph.html`** — Interactive SVG feedback topology visualization
- **`output/narrative-digest.md`** — Prose narrative of the composition run
- **`output/run-comparison.json`** — A/B profile comparison results (when `npm run compare` is used)
- **`output/composition-diff.json`** + **`composition-diff.md`** — Structural composition diff (when `npm run diff` is used)
- **`output/trace-replay.json`** — Trace replay output (when `npm run replay -- --json` is used)

## Music21 & Priors

`scripts/music21/` contains Python scripts for musicological analysis via the Music21 library. Run via `npm run music21-data`.

### Priors Export Scripts

- **`export_harmonic_priors.py`** — Chord transition probability tables
- **`export_melodic_priors.py`** — Melodic interval probability tables
- **`export_rhythm_priors.py`** — Rhythmic pattern probability tables
- **`export_voice_leading_priors.py`** — Voice-leading preference tables

All scripts share `export_utils.py` and output data consumed by corresponding `*PriorsData.js` files in `src/`.

### Shared Priors Utilities

Two globals from `src/utils/` are used across all priors modules:
- `modeQualityMap` — canonical mode-to-quality map (never duplicate)
- `priorsHelpers` — `resolvePhase(opts)`, `resolveWeightOrDefault(table, key, fallback)`, `weightedAdjustment(weight, scale)`

## Documentation Index

- [README.md](README.md) — This document — comprehensive project overview
- [.github/copilot-instructions.md](.github/copilot-instructions.md) — Concise coding rules guide for AI assistants and contributors
- [ARCHITECTURE.md](ARCHITECTURE.md) — Beat lifecycle deep-dive — signal flow from conductor to emission
- [TUNING_MAP.md](TUNING_MAP.md) — Feedback loop constants, interaction partners, cross-constant invariants
- [output/conductor-map.md](output/conductor-map.md) — Auto-generated conductor intelligence map (per-run)
- [output/crosslayer-map.md](output/crosslayer-map.md) — Auto-generated cross-layer intelligence map (per-run)
- [output/narrative-digest.md](output/narrative-digest.md) — Auto-generated prose narrative (per-run)
- [FEEDBACK_GRAPH.json](FEEDBACK_GRAPH.json) — Feedback loop topology (source of truth for visualization)
