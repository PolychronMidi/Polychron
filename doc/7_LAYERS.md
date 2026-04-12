# 7-Layer Self-Coherence Audit

Ongoing tracker for systemic coherence improvements across all HME layers.
Each layer has: current state, fixes applied, and items for next dedicated pass.

## Layer 1: Enforcement (VERY TIGHT)

**State**: 36 invariants, 2 new check types (`symbols_have_kb`, `files_mtime_window`). Coverage gates now in place.

### Done
- All stress probes pass, no gaps found.
- Added `symbols_have_kb` invariant type — KB coverage check via direct JSON file scan (fallback from semantic search)
- Added `files_mtime_window` invariant type — temporal sync between any two file mtimes
- Invariant `top-callers-have-kb`: top 15 globals with ≥10 callers must have KB entries (lowered from top 10, ≥20)
- Invariant `trace-run-history-sync`: trace.jsonl and latest run-history snapshot must be within 5min
- 4 previous invariants: `7layers-doc-exists`, `kb-minimum-entries`, `trust-system-count`, `stutter-variant-registry`

### Next pass
- [x] Add invariant: coupling-labels-documented — all 11 active labels in trace.jsonl must appear in ARCHITECTURE.md (patterns_all_in_file)
- [x] Run evolve(invariants): 35/36 pass; `kb-minimum-entries` fixed (was checking missing JSON export dir, now checks Lance DB data files); only `trace-run-history-sync` warns (expected — pipeline stale by 30h)
- [x] `top-callers-have-kb`: all 15 pass
- [x] eslint-rules-count resolved: 22 rules confirmed (grep -v index.js masked no-requires-outside-index earlier); CLAUDE.md updated 21→22, added `no-empty-catch` entry
- [ ] Consider adding invariant: no `<|thinking|>` leak in KB entry content — requires new Python type `kb_content_no_pattern` (KB in Lance DB, not flat file)

## Layer 2: Knowledge Base (COMPREHENSIVE)

**State**: 90+ entries. All top-15 caller modules covered. Curate candidates documented.

### Done
- All top-15 highest-caller modules seeded (conductorIntelligence through explainabilityBus)
- Coupling labels: tension-flicker, flicker-phase semantics documented (fad6a8991c40)
- roleSwap↔cadenceAlignment lock analysis: confirmed intentional design (07eca0b86bf7)
- directionBias expansion: 3 candidate consumers identified (56fb53c5f713)
- L0 bypass pattern: emergentMelodicEngine.getContext() as synchronous per-beat pull (d3f2cfd5288f)
- dynamicEnvelope second-organism cluster mapped (0c206ec5c9ec)
- EnCodec S1 entropy anomaly documented as possible truncation artifact (e1e163ba7881)
- densityMean >2σ spike (0.470 vs 0.443 mean) documented as texture accumulation pattern (146751f990c7)

### Next pass
- [x] Seed modules below the top-15 threshold: traceDrain (28 callers) and systemDynamicsProfiler (41 callers) seeded
- [x] Add KB entry: section count confirmed as 6 (S0–S5); S0 entropy anomaly documented as warmup, not truncation
- [x] Contradiction scanner: synthesis-entry false-positives fixed — `_has_relation` now skips pair if EITHER entry has ANY synthesizes/supersedes/clarifies tag; also skips shared-round pairs unconditionally
- [x] Seed remaining below-threshold modules: entropyAmplificationController, regimeClassifier, pipelineCouplingManager seeded
- [ ] Seed next tier: crossLayerRegistry, feedbackRegistry, signalReader (still uncovered)

## Layer 3: Tool Output Quality (FULLY FIXED)

**State**: All 6 thinking artifact patterns handled. All find modes produce useful JS-native output.

### Done
- `<think>` / `</think>` tags stripped (extracting answer, not thinking)
- Reasoning marker heuristic: 25 markers, ≥2 hits + >400 chars → tail extraction
- Relation-aware contradiction filter in evolution_evolve.py
- Markdown ` ```thinking ``` ` / ` ```reasoning ``` ` block stripping in both _local_think and _local_chat
- `<|thinking|>` / `<|answer|>` / `<|/thinking|>` tag variants stripped (both functions)
- find xref: JS→JS module trace (definition, callers, require chain, exported API, KB constraints)
- find hierarchy: IIFE module dependency graph + manager/helper pair detection
- find lookup: dotted symbol paths (module.method)
- trace(mode='module'): crossLayer prefix alias matching
- review convention: console.warn format, fallback patterns, JSDoc verbosity, IIFE, self-registration
- forge sketch: method-patching enforcement, API validation (warns on unverified method calls)

### Next pass
- [x] Add `<|im_start|>` / `<|im_end|>` ChatML tag stripping (used by Qwen models)
- [x] Hierarchy mode: subsystem-level rollup (files, avg_deps, total_users per src/ subsystem)
- [x] Forge validation: re-prompt model with valid symbol list if >2 unknown methods detected (second attempt with corrected sketch)
- [x] find xref reverse: step 4 "Outgoing dependencies" added — scans module file for architectural global references (what does this module read from others?)
- [x] Hierarchy mode: de-facto hubs section added — detects modules with >2× subsystem median caller count regardless of *Manager.js filename
- [ ] find xref exported API: symbol table has low coverage of JS functions — needs reindex after batch changes
- [ ] Hierarchy mode: improve subsystem median weighting to exclude index.js and single-use helpers

## Layer 4: Data Coherence (STALENESS FULLY SURFACED)

**State**: Stale data surfaces in 3 places: beat_snapshot, composition arc, and status(all/freshness).

### Done
- beat_snapshot: warns when trace.jsonl diverges from run-history by >5min
- review composition: same warning
- `status(mode='freshness')`: tabular report of all 9 data sources with age + sync check
- `status(mode='all')`: compact freshness summary at top — surfaces STALE/MISSING/SYNC flags inline

### Next pass
- [ ] Unify all tool reads to a single "current run" pointer — complex; requires pipeline script change + symlink + tool updates
- [ ] Verify EnCodec S1 WAV truncation hypothesis — output1/2.wav are combined 3.7min files (not per-section); can only verify S0 entropy after next pipeline run with EnCodec section breakdown
- [x] Surface adaptive-state.json staleness in status(all) — VERY_STALE flag (>7d) added to compact freshness summary

## Layer 5: Architectural Intelligence (MATURE)

**State**: xref, hierarchy, lookup, convention, forge — all work correctly for JS CommonJS projects.

### Done
- find xref: full JS→JS trace (definition → callers → require chain → exported API → KB)
- find hierarchy: IIFE dep graph, most-depended globals, manager/helper pairs
- find lookup: dotted path resolution
- forge API validation: warns on unverified `module.method()` calls in generated sketch
- symbols_have_kb: KB coverage invariant with text-scan fallback (not just semantic search)

### Next pass
- [ ] find xref reverse: "what does this module import from others?" (outgoing dependency scan)
- [x] Hierarchy: subsystem-level rollup done (files, avg_deps, total_users per src/ subsystem)
- [x] Forge validation: re-prompt with valid symbol list done

## Layer 6: Compositional Self-Awareness (SECOND ORGANISM DESIGNED)

**State**: Single-organism topology confirmed intentional. Second-organism path designed.

### Done
- Topology: 1 cluster, 24 members, tightest bond roleSwap↔cadenceAlignment (r=0.994)
- Confirmed lock is intentional: both read emergentMelodicEngine + emergentRhythm simultaneously
- directionBias: 5 consumers, 3 expansion candidates identified (dynamicRoleSwap, voice-alloc, articulation)
- dynamicEnvelope second-organism triad: envelope + roleSwap + interactionHeatMap directly coupled

### Next pass
- [x] L0 swapDecision channel: added `L0_CHANNELS.swapDecision`; dynamicRoleSwap posts on each swap; articulationComplement and crossLayerDynamicEnvelope read via getLast instead of getIsSwapped()
- [x] directionBias consumer: `directionBiasSwapBoost` added to dynamicRoleSwap gate (±0.03 max, ascending=suppress, descending=boost)
- [x] directionBias in articulationComplement: `clamp(1.0 - directionBias * 0.06, 0.92, 1.06)` added as 4th factor in melodicContrastScale (ascending=softer, descending=sharper)
- [ ] Design contourShape evolution round: candidate modules — motifEcho, restSynchronizer, velocityInterference (all ignore contourShape currently)
- [ ] Test voicing layer as directionBias consumer (open voicing on ascent, close on descent)
- [ ] Topology second organism: pilot interactionHeatMap reading L0 channels instead of direct module calls

## Layer 7: Evolution Intelligence (FORGE-READY)

**State**: Forge sketch generator now validates API. L0 bypass topology documented and classified.

### Done
- Forge API validation: warns on unverified method calls before suggesting lab test
- L0 bypass classified as intentional per-beat synchronous pulls (not architectural drift)
- emergentMelodicEngine.getContext() identified as the most-bypassed synchronous pull (4 callers)
- directionBias expansion roadmap: 3 concrete modules, specific effect magnitudes mapped

### Next pass
- [x] Add ChatML `<|im_start|>` tag stripping to synthesis_ollama.py (used by Qwen coder model)
- [x] Forge re-prompt: re-prompt with valid symbol list if >2 unknown methods; re-validates corrected sketch
- [x] evolve(forge) run: 2 clean sketches generated (convergenceHarmonicTrigger↔verticalIntervalMonitor, entropyRegulator↔convergenceHarmonicTrigger); no API warnings fired
- [ ] Execute top forge sketch in lab — paste convergenceHarmonicTrigger↔verticalIntervalMonitor sketch into lab/sketches.js and run
- [ ] Design multi-organism round: interactionHeatMap as L0 consumer — break direct module calls into event reads
- [ ] `kb_content_no_pattern` Python invariant type: scan Lance KB entries for `<|thinking|>` / `<think>` leaks
