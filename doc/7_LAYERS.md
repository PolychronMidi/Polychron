# 7-Layer Self-Coherence Audit

Ongoing tracker for systemic coherence improvements across all HME layers.
Each layer has: current state and items for next dedicated pass.

## Layer 1: Enforcement (TIGHT)

**State**: 40 invariants. `symbols_have_kb`, `files_mtime_window`, `kb_content_no_pattern`, `kb_freshness` types live. `coupling-labels-documented` enforces ARCHITECTURE.md sync. `kb-no-thinking-leak` guards LLM artifact leaks. `directionbias-documented` guards directionBias coupling doc coverage. `kb-freshness` warns if no KB entry updated in >14 days.

### Next pass
- seed remaining modules below top-15 as they become edit targets

## Layer 2: Knowledge Base (COMPREHENSIVE)

**State**: 104 entries. All top-15 caller modules covered. velocityInterference, articulationComplement, convergenceDetector, convergenceVelocitySurge, grooveTransfer, crossLayerDynamicEnvelope all seeded.

### Next pass
- seed remaining modules below top-15 as they become edit targets

## Layer 3: Tool Output Quality (SOLID)

**State**: 6 thinking artifact patterns stripped. JS-native hierarchy (IIFE dep graph, de-facto hubs, subsystem rollup, outgoing deps). Forge re-prompts with valid symbol list on >2 unknown methods. Hierarchy de-facto hub median now excludes single-use helpers and helper-suffix files. Symbol index refreshed.

### Next pass
- ongoing: reindex after major batch changes if watcher hasn't caught up

## Layer 4: Data Coherence (SOLID)

**State**: `metrics/current-run.json` unified pointer written by `snapshot-run.js` every pipeline run — tools read this instead of hunting the latest run-history snapshot. `current-run-valid` invariant guards against corrupt JSON. adaptive-state.json warm-start healthy (9 keys, load-and-clamp prevents stressed-state boot loops, VERY_STALE auto-clears after successful run). EnCodec S1 truncation hypothesis verified NOT confirmed (S0=6.040, S1=6.176 — normal tension arc). `trace-run-history-sync` invariant enforces mtime coherence (300s window). current-run.json in freshness display (verified).

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

## Layer 7: Evolution Intelligence (FORGE-READY)

**State**: Forge validates API, re-prompts with valid symbol list, ChatML tags stripped. `kb_content_no_pattern` + `kb_freshness` invariants live (guards 104 KB entries). Forge sketch for convergenceHarmonicTrigger↔verticalIntervalMonitor written with correct densitySurprise bridge (rarity boost + penalty scale). Lab runner requires ~10 min for full render pipeline.

### Next pass
- Forge sketch ran successfully: 287.6s gen, 106.4s audio → `lab/forge-convergenceHarmonicTrigger-verticalIntervalMonitor.wav`. densitySurprise bridge (rarity boost + penalty scale) verified clean. Ready for listening verdict.
- interactionHeat L0 channel implemented: flushBeat/flushBeatPair post `{ trend, slope, density, absoluteSeconds }`; crossLayerDynamicEnvelope reads via `L0.getLast(L0_CHANNELS.interactionHeat)` with direct-call fallback. ARCHITECTURE.md updated. Verified by pipeline run.
