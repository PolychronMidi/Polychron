# 7-Layer Self-Coherence Audit

Ongoing tracker for systemic coherence improvements across all HME layers.
Each layer has: current state and items for next dedicated pass.

## Layer 1: Enforcement (TIGHT)

**State**: 40 invariants (39 pass, 1 trace-sync warning that clears after pipeline). 14 invariant types: `files_executable`, `files_referenced`, `file_exists`, `symlink_valid`, `json_valid`, `glob_count_gte`, `pattern_in_file`, `patterns_all_in_file`, `pattern_count_gte`, `symbols_used`, `symbols_have_kb`, `files_mtime_window`, `kb_content_no_pattern`, `kb_freshness`. `coupling-labels-documented` enforces ARCHITECTURE.md sync. `kb-no-thinking-leak` guards LLM artifact leaks. `directionbias-documented` guards directionBias coupling doc coverage. `kb-freshness` warns if no KB entry updated in >14 days. `current-run-valid` guards output/metrics/current-run.json integrity.

### Next pass
- seed remaining modules below top-15 as they become edit targets

## Layer 2: Knowledge Base (COMPREHENSIVE)

**State**: 105 entries. All top-15 caller modules covered. velocityInterference, articulationComplement, convergenceDetector, convergenceVelocitySurge, grooveTransfer, crossLayerDynamicEnvelope, interactionHeatMap all seeded. Zero thinking-leak artifacts (invariant-enforced).

### Next pass
- seed remaining modules below top-15 as they become edit targets

## Layer 3: Tool Output Quality (SOLID)

**State**: 6 thinking artifact patterns stripped. JS-native hierarchy (IIFE dep graph, de-facto hubs, subsystem rollup, outgoing deps). Forge re-prompts with valid symbol list on >2 unknown methods. Hierarchy de-facto hub median now excludes single-use helpers and helper-suffix files. Symbol index: 716 files, 3244 chunks, 4600 symbols.

### Next pass
- ongoing: reindex after major batch changes if watcher hasn't caught up (index drifts under compaction — `hme_admin(action='clear_index')` rebuilds from scratch)

## Layer 4: Data Coherence (SOLID)

**State**: `output/metrics/current-run.json` unified pointer written by `snapshot-run.js` every pipeline run — tools read this instead of hunting the latest run-history snapshot. `current-run-valid` invariant guards against corrupt JSON. adaptive-state.json warm-start healthy (9 keys, load-and-clamp prevents stressed-state boot loops, VERY_STALE auto-clears after successful run). EnCodec S1 truncation hypothesis verified NOT confirmed (S0=6.040, S1=6.176 — normal tension arc). `trace-run-history-sync` invariant enforces mtime coherence (300s window). current-run.json in freshness display (verified).

### Next pass
- ongoing: monitor perceptual data consistency between snapshot-run inline capture and post-render perceptual-analysis

## Layer 5: Architectural Intelligence (MATURE)

**State**: xref (definition→callers→require chain→exported API→outgoing deps→KB), hierarchy (IIFE dep graph, hubs, subsystem rollup), lookup, convention, forge — all work correctly for JS CommonJS projects. Hierarchy hub median fixed (single-use helpers and helper-suffix files excluded). Symbol index refreshed after batch changes.

### Next pass
- ongoing: reindex after major batch changes if watcher hasn't caught up

## Layer 6: Compositional Self-Awareness (MATURE)

**State**: L0 swapDecision channel live. directionBias in 8 consumer files (voiceModulator spread +/-8% via L0 emergentMelody). contourShape couplings in convergenceVelocitySurge (+/-8%/-7%), grooveTransfer (+/-6%), velocityInterference (+/-7%/-5%), stutterContagion (x1.07/x0.93). interactionHeat L0 channel: flushBeat/flushBeatPair post `{ trend, slope, density }`; 4 consumers now read via L0 with direct-call fallback (crossLayerDynamicEnvelope, crossLayerClimaxEngine, crossLayerSilhouette, processBeat). 43 L0 channels defined, all referenced (invariant-enforced). ARCHITECTURE.md documents all directionBias + contourShape + interactionHeat couplings; directionbias-documented invariant enforces doc sync.

### Next pass
- seed remaining modules below top-15 as they become edit targets

## Layer 7: Evolution Intelligence (MATURE)

**State**: Forge validates API, re-prompts with valid symbol list, ChatML tags stripped. `kb_content_no_pattern` + `kb_freshness` invariants live (guards 105 KB entries). Forge sketch for convergenceHarmonicTrigger↔verticalIntervalMonitor ran successfully (287.6s gen, 106.4s audio) — densitySurprise bridge verified clean, ready for listening verdict. `fix_antipattern` hardened: `bash -n` syntax validation gate rejects broken snippets before writing to hooks, `max_tokens` bumped 256->512. Stop hook detects stop-work antipattern (dismissive text, text-only-short responses) and blocks. Lab runner requires ~10 min for full render pipeline.

### Next pass
- ongoing: forge listening verdict for convergenceHarmonicTrigger↔verticalIntervalMonitor sketch
- ongoing: monitor fix_antipattern output quality now that validation gate is live
