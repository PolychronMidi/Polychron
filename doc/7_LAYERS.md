# 7-Layer Self-Coherence Audit

Ongoing tracker for systemic coherence improvements across all HME layers.
Each layer has: current state and items for next dedicated pass.

## Layer 1: Enforcement (TIGHT)

**State**: 39 invariants. `symbols_have_kb`, `files_mtime_window`, `kb_content_no_pattern`, `kb_freshness` types live. `coupling-labels-documented` enforces ARCHITECTURE.md sync. `kb-no-thinking-leak` guards LLM artifact leaks. `directionbias-documented` guards directionBias coupling doc coverage. `kb-freshness` warns if no KB entry updated in >14 days.

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

## Layer 4: Data Coherence (IMPROVING)

**State**: `metrics/current-run.json` unified pointer now written by `snapshot-run.js` on every pipeline run — tools can read this instead of hunting the latest run-history snapshot. adaptive-state.json VERY_STALE flag will clear after next successful run.

### Next pass
- EnCodec S1 truncation hypothesis verified NOT confirmed: per-section cb0 entropy S0=6.040, S1=6.176, S2=6.240, S3=6.924, S4=6.162, S5=6.145, S6=6.134 — S1 is higher than S0, normal tension arc, no truncation artifact.
- current-run.json now appears in freshness display (verified after reload)

## Layer 5: Architectural Intelligence (MATURE)

**State**: xref (definition→callers→require chain→exported API→outgoing deps→KB), hierarchy (IIFE dep graph, hubs, subsystem rollup), lookup, convention, forge — all work correctly for JS CommonJS projects. Hierarchy hub median fixed (single-use helpers and helper-suffix files excluded). Symbol index refreshed after batch changes.

### Next pass
- ongoing: reindex after major batch changes if watcher hasn't caught up

## Layer 6: Compositional Self-Awareness (EXPANDING)

**State**: L0 swapDecision channel live. directionBias in 8 consumer files (added voiceModulator spread ±8% via L0 emergentMelody). contourShape couplings in convergenceVelocitySurge (±8%/−7%), grooveTransfer (±6%), velocityInterference (±7%/−5%), stutterContagion (×1.07/×0.93). ARCHITECTURE.md documents all directionBias + contourShape couplings; directionbias-documented invariant updated. interactionHeat L0 channel live: flushBeat/flushBeatPair post trend+density, crossLayerDynamicEnvelope reads via L0 with fallback.

### Next pass
- seed remaining modules below top-15 as they become edit targets

## Layer 7: Evolution Intelligence (FORGE-READY)

**State**: Forge validates API, re-prompts with valid symbol list, ChatML tags stripped. `kb_content_no_pattern` + `kb_freshness` invariants live (guards 104 KB entries). Forge sketch for convergenceHarmonicTrigger↔verticalIntervalMonitor written with correct densitySurprise bridge (rarity boost + penalty scale). Lab runner requires ~10 min for full render pipeline.

### Next pass
- Forge sketch ran successfully: 287.6s gen, 106.4s audio → `lab/forge-convergenceHarmonicTrigger-verticalIntervalMonitor.wav`. densitySurprise bridge (rarity boost + penalty scale) verified clean. Ready for listening verdict.
- interactionHeat L0 channel implemented: flushBeat/flushBeatPair post `{ trend, slope, density, absoluteSeconds }`; crossLayerDynamicEnvelope reads via `L0.getLast(L0_CHANNELS.interactionHeat)` with direct-call fallback. ARCHITECTURE.md updated. Verified by pipeline run.
