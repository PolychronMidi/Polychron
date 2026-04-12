# 7-Layer Self-Coherence Audit

Ongoing tracker for systemic coherence improvements across all HME layers.
Each layer has: current state and items for next dedicated pass.

## Layer 1: Enforcement (TIGHT)

**State**: 38 invariants. `symbols_have_kb`, `files_mtime_window`, `kb_content_no_pattern` types live. `coupling-labels-documented` enforces ARCHITECTURE.md sync. `kb-no-thinking-leak` guards LLM artifact leaks (101 entries clean). `directionbias-documented` guards directionBias coupling doc coverage.

### Next pass
- [ ] Consider adding invariant: KB entry age check — warn if no KB entries updated in >14 days (staleness signal)

## Layer 2: Knowledge Base (COMPREHENSIVE)

**State**: 101 entries. All top-15 caller modules covered. velocityInterference, articulationComplement, convergenceDetector seeded this session.

### Next pass
- [ ] Seed next tier: convergenceVelocitySurge, grooveTransfer, crossLayerDynamicEnvelope (all below top-15, many callers)

## Layer 3: Tool Output Quality (SOLID)

**State**: 6 thinking artifact patterns stripped. JS-native hierarchy (IIFE dep graph, de-facto hubs, subsystem rollup, outgoing deps). Forge re-prompts with valid symbol list on >2 unknown methods.

### Next pass
- [ ] find xref exported API: symbol table has low coverage of JS functions — needs reindex after batch changes
- [ ] Hierarchy mode: improve subsystem median weighting to exclude index.js and single-use helpers

## Layer 4: Data Coherence (STALENESS SURFACED)

**State**: Stale data surfaces in beat_snapshot, composition arc, and status(all/freshness). adaptive-state.json VERY_STALE flag active (>7d).

### Next pass
- [ ] Unify all tool reads to a single "current run" pointer — complex; requires pipeline script change + symlink + tool updates
- [ ] Verify EnCodec S1 WAV truncation hypothesis — can only verify S0 entropy after next pipeline run with EnCodec section breakdown

## Layer 5: Architectural Intelligence (MATURE)

**State**: xref (definition→callers→require chain→exported API→outgoing deps→KB), hierarchy (IIFE dep graph, hubs, subsystem rollup), lookup, convention, forge — all work correctly for JS CommonJS projects.

### Next pass
- [ ] find xref exported API: symbol table low coverage of JS functions (see Layer 3)
- [ ] Hierarchy: improve subsystem median weighting to exclude index.js and single-use helpers (see Layer 3)

## Layer 6: Compositional Self-Awareness (EXPANDING)

**State**: L0 swapDecision channel live. directionBias in 7 consumer files. contourShape couplings in convergenceVelocitySurge (±8%/−7%), grooveTransfer (±6%), velocityInterference (±7%/−5%). Forge sketch for convergenceHarmonicTrigger↔verticalIntervalMonitor written and ready in lab/sketches.js.

### Next pass
- [ ] contourShape round: find next module with unused contourShape dim — check motifEcho, feedbackOscillator, stutterContagion
- [ ] Test voicing layer as directionBias consumer (open voicing on ascent, close on descent)
- [ ] Topology second organism: pilot interactionHeatMap reading L0 channels instead of direct module calls

## Layer 7: Evolution Intelligence (FORGE-READY)

**State**: Forge validates API, re-prompts with valid symbol list, ChatML tags stripped. `kb_content_no_pattern` invariant live (guards 101 KB entries). Forge sketch for convergenceHarmonicTrigger↔verticalIntervalMonitor written with correct densitySurprise bridge (rarity boost + penalty scale).

### Next pass
- [ ] Run forge sketch: `node lab/run.js forge-convergenceHarmonicTrigger-verticalIntervalMonitor` — sketch is in lab/sketches.js (densitySurprise bridge: surprise→more harmonic triggers + tighter collision penalty)
- [ ] Design multi-organism round: interactionHeatMap as L0 consumer — break direct module calls into event reads
