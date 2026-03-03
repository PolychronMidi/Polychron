# Polychron Architecture: The Anatomy of a Beat

Polychron generates music through **emergent coherence**—an evolutionary process where multiple independent observers influence a shared signal field, and complex feedback loops resolve contradictions into musicality. Rather than hardcoding structure, the system steers it.

To understand Polychron, you must understand the lifecycle of a single beat. This document traces the signal flow from the initial context gathering to the final emission of notes, illuminating the strict boundaries that keep the system musical instead of chaotic.

---

## 1. The Conductor Pipeline (`globalConductor.update`)
At the start of every beat, before any layer knows what it will play, the **Conductor** re-evaluates the state of the composition.

1. **Context Gathering:** The system queries structural context—what section are we in? Are we at the climax? What is the current harmonic excursion and tension?
2. **Composite Intensity:** Baseline structural cues and harmonic rhythm are merged into a single metric, `compositeIntensity` (0.0 - 1.0).
3. **The Recorders:** 42 intelligence modules (e.g., `dynamicRangeTracker`, `melodicContourTracker`) observe this intensity alongside recent output, updating their internal states.
4. **Attributed Biases:** Modules cast "votes" for density, tension, and flicker via multiplicative biases. These votes are gathered, multiplied, and attributed in the `conductorIntelligence` registry.
5. **Dampening & Normalization:** `conductorDampening` limits extreme deviation based on system regimes, preventing runaway feedback. `pipelineNormalizer` smooths these into actionable targets.
6. **State Snapshot:** The final resolved signals—`playProb`, `stutterProb`, `density`, `tension`, `flicker`—are committed to `conductorState`.

---

## 2. The Signal Bridge (`conductorSignalBridge`)
**Firewall Boundary 1: The Conductor is Blind to Cross-Layer Negotiation.**
The conductor signals are cached beat-by-beat in the `conductorSignalBridge`. Cross-layer modules *cannot* directly read raw conductor signals. They query this bridge. This is an explicit, load-bearing firewall: it prevents the microscopic interplay of rhythm from polluting the macroscopic trajectories of the composition, imposing a minimal beat-delayed latency.

---

## 3. The Play Loop (`processBeat`)
With the conductor's intent crystallized, the structural components prepare the beat across an interleaved, 14-stage topological sequence.

1. **Beat Setup:** Set binaural mapping, panning, balance, and start FX stutter preparation.
2. **Intent & Entropy:** `sectionIntentCurves` resolves the structural arc, while `entropyRegulator` defines an allowable variance threshold.
3. **Phase Lock:** `rhythmicPhaseLock` determines whether layers synchronize or complement each other.
4. **Rest Sync:** The `restSynchronizer` forces emergent rests, aligning layer absences based on thermal load (heatMap).
5. **Cadence & Tension:** The system probes whether a harmonic cadence is biologically due, guided by systemic tension.

---

## 4. Negotiation (`negotiationEngine`)
**Firewall Boundary 2: Trust-Weighted Intent.**
Even though the conductor declares an intent and the initial cross-layer stages suggest a path, these are not directly executed. They pass through the `negotiationEngine`.
Here, `adaptiveTrustScores` applies moving average weights (0.4 to 1.8) to the recommendations of various cross-layer actors. A module the system "trusts" gets more sway over the final `playProb` and `stutterProb` for the specific layer and beat. This forces consensus through compromise.

---

## 5. Emission (`playNotes` & `playNotesEmitPick`)
With the probabilities finalized, the system finally iterates through the micro-units (divisions, subdivisions).
Notes are picked via the assigned `ScaleComposer` or `MeasureComposer`.
Stutter effects apply localized fading and panning.
The actual MIDI/CSV event is pushed to the buffer.

Cross-layer modules that emit notes (e.g., `emergentDownbeat`, `convergenceDetector`, `velocityInterference`) route all buffer writes through `crossLayerEmissionGateway.emit(sourceModule, buffer, event)`. This provides attributed emission counting and a centralized boundary for future buffer guards.

---

## 6. Closing the Loop (`crossLayerBeatRecord` & `coherenceMonitor`)
After the notes are emitted, the system enters the post-beat phase. It has generated music, but it needs to know *what* it generated to inform the next beat.

1. **Beat Interleaved Processor:** Captures exact note pitch, velocity, and timing.
2. **Heatmap & Trend:** `interactionHeatMap` maps the burst density against silence.
3. **Trust Adjustments:** If a module pushed for a cadence and it successfully resolved the music's chaos, its trust increases. Trust system names are canonical constants defined in `trustSystems` (see `src/utils/trustSystems.js`) — never hardcoded strings.
4. **Coherence Monitor:** **Firewall Boundary 3: Closed-Loop Output Verification.**
`coherenceMonitor` listens to the output layer and checks if the actual density matches the conductor's intended density. If the stochastic elements under-produced notes, it sends a bias multiplier back to the conductor to slightly boost density on the *next* beat. This is the only way output affects input, and it operates through a dampened, delayed feedback registry, preventing catastrophic resonance.

When `--trace` is enabled, each beat also writes a JSONL diagnostic entry to `metrics/trace.jsonl` (via `traceDrain`), including per-stage timing data (14 named stages, nanosecond precision via `process.hrtime.bigint()`), making this full loop replayable and profilable over time.

---

## The Emergence Boundaries (Membranes)

Every time you build a new module, you must respect these cellular boundaries:

* **Top-Down Steering Only:** The Conductor sets the climate. The Cross-Layer orchestrates the weather. The play loop experiences it. Cross-layer modules *cannot* write to the conductor directly. They must operate locally via `explainabilityBus` adjustments or influence the `playProb`/`stutterProb` locally out of the conductor's sight. Conversely, conductor modules *cannot* mutate cross-layer state (ESLint-enforced via `no-direct-crosslayer-write-from-conductor`); read-only access via getters is permitted.
* **Network Dampening:** Any new feedback loop must register with `feedbackRegistry`. The closed-loop controller mechanism ensures that phase misalignment and thermal loads do not cause feedback loops to resonate and destroy the system's structural integrity. Eight feedback loops are formally declared in `doc/FEEDBACK_GRAPH.json` and cross-validated against source code by `scripts/validate-feedback-graph.js` on every pipeline run.
* **Absolute AbsoluteTimeGrid:** Modules do not speak directly to each other; they post signals into `absoluteTimeGrid`, and interested modules query the timestamps. This ensures spatial decoupling and guarantees that chronological reasoning remains immutable.

Understand this beat, and you will understand Polychron.
