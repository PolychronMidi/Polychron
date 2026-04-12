# 7-Layer Self-Coherence Audit

Ongoing tracker for systemic coherence improvements across all HME layers.
Each layer has: current state, fixes applied, and items for next dedicated pass.

## Layer 1: Enforcement (TIGHT)

**State**: 35/35 stress probes, 33 invariants (was 29). Airtight.

### Done
- All probes pass, no gaps found.
- Added 4 new declarative invariants: `7layers-doc-exists`, `kb-minimum-entries`, `trust-system-count` (27 pair assignments), `stutter-variant-registry` (19 requires)

### Next pass
- [ ] Add invariant: top-10 caller modules must have KB entries (seed mode found 15 uncovered)
- [ ] Add invariant: all active coupling labels must appear in KB
- [ ] Add invariant: trace.jsonl and run-history latest snapshot must be from same pipeline run (Layer 4 fix)

## Layer 2: Knowledge Base (IMPROVED)

**State**: 73 entries, healthy, 0 duplicates. 3 synthesis arcs added. 2 stale entries removed.

### Done
- Removed superseded trust pair entry (e664f3afc2ae)
- Removed stale grooveTransfer pre-R45 pairs (a4faa630b6d3)
- Added synthesis: R73-R79-R85 densitySurprise antagonism arc (43bc1e03c511)
- Added synthesis: R54-R57-R58-R59-R65 melodic integration arc (68e6368945d8)
- Added synthesis: R48-R80 HME meta-loop arc (a908a0e0eb46)
- Resolved R48 regime number conflict (7b05ff623758)
- Seeded KB entries for top 5 uncovered high-caller modules

### Next pass
- [ ] Seed remaining 10 uncovered high-caller modules (safePreBoot thru explainabilityBus)
- [ ] Document coupling labels tension-flicker and flicker-phase in KB
- [ ] Review curate candidates: densityMean >2sigma spike, section count 6->7
- [ ] Improve contradiction scanner: train local model to distinguish temporal sequence from contradiction

## Layer 3: Tool Output Quality (FIXED)

**State**: LLM thinking artifacts eliminated. Contradiction false positives reduced.

### Done
- Fixed `<think>` tag stripping in synthesis_ollama.py (was extracting thinking as answer)
- Expanded reasoning marker list (12->25) and lowered threshold (>=4/1500 -> >=2/400)
- Added relation-aware filter to contradiction scanner (evolution_evolve.py)
- Fixed trace module mode to accept module names (not just trust system names)
- Fixed find lookup mode to resolve dotted symbol paths (e.g. module.method)
- Fixed review convention mode to do actual style/naming/validator checks

### Next pass
- [x] ~~Improve forge sketch quality: detect global-replacement antipattern, prefer method patching~~ (done: coupling_bridges.py prompt now enforces method-patching pattern)
- [ ] Fix find xref mode: handle JS->JS cross-module traces (currently looks for Rust)
- [ ] Fix find hierarchy mode: extract JS prototype chains, not just TS interfaces
- [ ] Add post-processing to all LLM outputs: strip markdown thinking artifacts (```thinking blocks)

## Layer 4: Data Coherence (STALENESS WARNINGS ADDED)

**State**: Different tools were reading from different pipeline runs without warning.

### Done
- beat_snapshot warns when trace.jsonl timestamp diverges from latest run-history snapshot
- review composition mode warns when data sources are from different runs

### Next pass
- [ ] Unify all tool data sources to read from a single "current run" pointer
- [ ] Add `status(mode='freshness')` showing age of each data source
- [ ] Flag EnCodec S1 entropy anomaly (1.00 bits vs S0 5.83) as potential truncation artifact

## Layer 5: Architectural Intelligence (STRONG)

**State**: blast, map, rename, design, curate, forge, preflight all work well. Edge cases fixed.

### Done
- trace module mode now accepts module names (alias-based matching for crossLayer prefix variants)
- find lookup resolves dotted paths (engine_symbols.py split on dot, filter by module in file path)
- forge sketch prompt now enforces method-patching over global replacement (coupling_bridges.py)
- review convention mode now checks: console.warn format, fallback patterns, JSDoc verbosity, IIFE structure, self-registration, file name↔export match

### Next pass
- [ ] find xref: JS->JS cross-module flow tracing
- [ ] find hierarchy: JS prototype/class chain extraction
- [ ] evolve design: validate proposed code against actual module API before generating

## Layer 6: Compositional Self-Awareness (SINGLE-ORGANISM)

**State**: All 24 cooperating modules form one cluster. No second organism. dynamicEnvelope is sole external antagonist.

### Done
- Documented topology: 1 cluster, 24 members, tightest bond roleSwap<->cadenceAlignment (r=0.994)
- Identified: directionBias (5 users) is sparsest melodic dimension
- Identified: contourShape and counterpoint untouched in last 6 rounds

### Next pass
- [ ] Investigate whether dynamicEnvelope could seed a second organism (3 modules: envelope + roleSwap + ?)
- [ ] Test directionBias expansion: add 3 more consumers to bring from 5 to 8
- [ ] Design contourShape evolution round targeting untouched modules
- [ ] Analyze roleSwap<->cadenceAlignment lock (r=0.994): too tight? Should they decouple?

## Layer 7: Evolution Intelligence (RICH)

**State**: 57% legendary rate. 3 saturated pairs. 12 L0 bypass opportunities.

### Done
- Identified 3 unsaturated antagonist pairs with design proposals ready
- Mapped 12 modules where callers bypass L0 channels
- Cataloged evolution velocity: 0% legendary in last 6 rounds

### Next pass
- [ ] Execute top forge sketch (convergenceHarmonicTrigger<->verticalIntervalMonitor densitySurprise bridge)
- [ ] Investigate L0 bypass pattern: are direct callers intentional or architectural drift?
- [ ] Design a "multi-organism emergence" round: decouple the tightest cooperation bonds
- [ ] Target contourShape + counterpoint dimensions for next evolution arc
