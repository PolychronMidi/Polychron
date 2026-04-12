# 7-Layer Self-Coherence Audit

Ongoing tracker for systemic coherence improvements across all HME layers.
Each layer has: current state, fixes applied, and items for next dedicated pass.

## Layer 1: Enforcement (TIGHT)

**State**: 35/35 stress probes, 34 invariants (was 29). New `symbols_have_kb` invariant type.

### Done
- All probes pass, no gaps found.
- Added 4 declarative invariants: `7layers-doc-exists`, `kb-minimum-entries`, `trust-system-count` (27 pair assignments), `stutter-variant-registry` (19 requires)
- Added new invariant type `symbols_have_kb` to evolution_invariants.py + checkers dispatch
- Added invariant `top-callers-have-kb`: top 10 highest-caller IIFE globals (≥20 callers) must each have a KB entry
- `_types` doc updated in invariants.json

### Next pass
- [ ] Add invariant: all active coupling labels must appear in KB (needs trace.jsonl coupling label extraction)
- [ ] Add invariant: trace.jsonl and run-history must be within 5min of each other (temporal sync check)
- [ ] Consider `symbols_have_kb` with lower min_callers=10 once KB coverage improves further

## Layer 2: Knowledge Base (FULL COVERAGE)

**State**: 85+ entries, healthy, 0 duplicates. Top 15 caller modules all covered.

### Done
- Removed superseded trust pair entry (e664f3afc2ae)
- Removed stale grooveTransfer pre-R45 pairs (a4faa630b6d3)
- Added 3 synthesis arcs: densitySurprise, melodic integration, HME meta-loop
- Resolved R48 regime number conflict
- Seeded top 15 uncovered high-caller modules: conductorIntelligence, L0, conductorConfig, conductorState, trustSystems, validator, safePreBoot, timeStream, analysisHelpers, crossLayerRegistry, harmonicContext, adaptiveTrustScores, eventBus, pipelineCouplingManager, explainabilityBus
- Documented coupling labels: tension-flicker and flicker-phase semantics
- Added dynamicEnvelope second-organism cluster analysis
- Added L0 bypass pattern documentation

### Next pass
- [ ] Seed next 10 modules below the threshold (60-66 callers)
- [ ] Review curate candidates: densityMean >2sigma spike, section count 6->7
- [ ] Improve contradiction scanner: train local model to distinguish temporal sequence from contradiction

## Layer 3: Tool Output Quality (FIXED)

**State**: LLM thinking artifacts fully eliminated. All 4 find modes now work for JS projects.

### Done
- Fixed `<think>` tag stripping in synthesis_ollama.py (was extracting thinking as answer)
- Expanded reasoning marker list (12→25) and lowered threshold (≥4/1500 → ≥2/400)
- Added relation-aware filter to contradiction scanner (evolution_evolve.py)
- Fixed trace module mode to accept module names (alias-based matching for crossLayer prefix variants)
- Fixed find lookup mode to resolve dotted symbol paths (module.method)
- Fixed review convention mode: console.warn format, fallback patterns, JSDoc verbosity, IIFE structure, self-registration, file name↔export match
- Fixed forge sketch prompt: enforces method-patching over global replacement
- Added markdown fenced thinking block stripping: ` ```thinking ` and ` ```reasoning ` in both _local_think and _local_chat
- Fixed find xref mode: now provides full JS→JS module trace (definition, callers, require chain, KB constraints) when no Rust definition exists
- Fixed find hierarchy mode: detects JS IIFE module dependency graph (outbound deps, inbound users, most-depended globals) when no formal type hierarchy exists

### Next pass
- [ ] Fix find xref: KB context is appended but search relevance could be improved (semantic vs. name match)
- [ ] Add post-processing to all LLM outputs: strip bare `<|thinking|>` / `<|answer|>` tags used by some models
- [ ] Hierarchy mode: add manager/helper relationship detection (e.g., fooManager → fooHelper pattern)

## Layer 4: Data Coherence (STALENESS WARNINGS + FRESHNESS MODE)

**State**: All tools warn on stale data. New `status(mode='freshness')` gives full data source inventory.

### Done
- beat_snapshot warns when trace.jsonl timestamp diverges from latest run-history snapshot
- review composition mode warns when data sources are from different runs
- Added `status(mode='freshness')`: tabular report of age of every data source (trace, pipeline-summary, adaptive-state, feedback_graph, trace-replay, journal, conductor-map, crosslayer-map, narrative-digest, run-history), plus sync check between trace.jsonl and run-history
- Updated status tool docstring to document freshness mode

### Next pass
- [ ] Add freshness check to `status(mode='all')` summary — surface STALE/MISSING flags in the unified view
- [ ] Unify all tool data sources to read from a single "current run" pointer file
- [ ] Flag EnCodec S1 entropy anomaly (1.00 bits vs S0 5.83) as potential truncation artifact in KB

## Layer 5: Architectural Intelligence (STRONG)

**State**: All find/review/trace modes now work correctly for JS CommonJS projects.

### Done
- find xref: now traces JS→JS module chains (not dead-ends with "Rust not found")
- find hierarchy: now extracts IIFE module dependency graph (who uses what, most-coupled modules)
- find lookup: resolves dotted paths (module.method)
- trace(mode='module'): accepts module names via alias matching
- forge prompt: enforces method-patching pattern
- review convention: real style checks (not just KB mentions)
- symbols_have_kb: new invariant type for KB coverage gates

### Next pass
- [ ] find hierarchy: add manager/helper detection (detect modules named *Manager that depend on *Helper pairs)
- [ ] find xref: add "reverse xref" — what does this module's exported API expose to callers?
- [ ] evolve design: validate proposed code against actual module API before generating sketch

## Layer 6: Compositional Self-Awareness (SECOND ORGANISM MAPPED)

**State**: All 24 cooperating modules form one cluster. Second-organism candidate identified.

### Done
- Documented topology: 1 cluster, 24 members, tightest bond roleSwap↔cadenceAlignment (r=0.994)
- Identified: directionBias (5 users) is sparsest melodic dimension
- Identified: contourShape and counterpoint untouched in last 6 rounds
- **Investigated dynamicEnvelope cluster**: crossLayerDynamicEnvelope + dynamicRoleSwap + interactionHeatMap form a "dynamics decision triad" — all direct call dependencies. KB entry added (0c206ec5c9ec).
- dynamicEnvelope makes 5 direct calls per beat (roleSwap, interactionHeatMap, emergentMelodicEngine, sectionIntentCurves, conductorSignalBridge)

### Next pass
- [ ] Design L0-routing experiment: route dynamicRoleSwap.getIsSwapped() through an L0 channel to decouple the triad
- [ ] Analyze roleSwap↔cadenceAlignment lock (r=0.994): use coupling_intel to check if it suppresses diversity
- [ ] Test directionBias expansion: add 3 more consumers (currently only 5)
- [ ] Design contourShape evolution round targeting untouched modules

## Layer 7: Evolution Intelligence (RICH)

**State**: 57% legendary rate. 3 saturated pairs. L0 bypass topology documented.

### Done
- Identified 3 unsaturated antagonist pairs with design proposals
- Mapped L0 bypass pattern: emergentMelodicEngine.getContext() called from 4 modules directly; sectionIntentCurves.getLastIntent() from 2. KB entry added (d3f2cfd5288f).
- Confirmed bypasses are **intentional per-beat synchronous reads** — not architectural drift
- Cataloged evolution velocity: 0% legendary in last 6 rounds

### Next pass
- [ ] Execute top forge sketch (convergenceHarmonicTrigger↔verticalIntervalMonitor densitySurprise bridge)
- [ ] Evaluate L0-routing tradeoff: per-beat L0.post overhead vs. temporal buffering/replay benefit for bypass modules
- [ ] Design "multi-organism emergence" round: pilot L0 routing for dynamicRoleSwap → interactionHeatMap path
- [ ] Target contourShape + counterpoint dimensions for next evolution arc
