# HME Evolution Backlog

Active evolution list derived from deep codebase exploration after R62 LEGENDARY.
Last updated: 2026-04-06 (session following R62/HME consolidation rounds R1–R3).

---

## E1 — crossLayerClimaxEngine trace instrumentation (src/)

**What:** Add trust data emission from `crossLayerClimaxEngine` so it appears in `trace.jsonl`.

**Why:** Trust 0.46, cooperates r>0.45 with 7 modules (velocityInterference r=0.663,
stutterContagion r=0.643, convergenceHarmonicTrigger r=0.604, cadenceAlignment r=0.539,
phaseAwareCadenceWindow r=0.518, convergence r=0.496, texturalMirror r=0.451).
Highest-trust module in the system that HME cannot see at all — no trace, no KB, no docs.

**Scope:** Locate where trust emission happens in beat trace (likely play/main.js or
conductor trust module), add climaxEngine entry mirroring the pattern used by other modules.

**Unlock:** Once visible — trace_query, coupling_network blind spot detection,
drama_map, cluster_priority_targets reordering, trust_report all gain access to it.

---

## E2 — drama_map HME tool

**What:** New tool in `section_compare.py` that scans trace.jsonl for the composition's
most dramatically intense moments.

**Output:**
- Top 5 tension spikes with regime context (beat window ±3)
- Top 3 longest coherent blocks (sustained resolution passages)
- Top 3 biggest single-beat trust reversals (system falling while another rises)
- Density contrast pairs: atmospheric valley adjacent to peak density window

**Why:** Closes the "where is this piece most alive?" gap. Currently drama is felt only
via listening. With drama_map, you can see the skeleton of the composition's arc and
verify that dense/atmospheric variation (what drove R61→R62) is actually present and
where it lives.

**Dimension:** Tool, ~80 lines in section_compare.py. No new dependencies.

---

## E3 — evolution_momentum HME tool + dimension-rut detection

**What:** Parse `metrics/journal.md` + project KB to produce a full momentum timeline.

**Output:**
```
R50-R54: architecture (5/5 rounds)
R55-R58: melodic coupling (4/4 rounds)
R59-R62: melodic coupling + micro-dynamics (4 rounds) ← current

Dimension rut: contourShape used 5/6 recent couplings
  contourShape: restSynchronizer, phraseArcProfiler, articulationComplement, 2 more
  thematicDensity: only cadenceAlignment (R58) — untouched 4 rounds
  counterpoint: convergenceHarmonicTrigger candidate — never used

KB-confirmed subsystem receptivity:
  crossLayer: 8/10 confirmed (80%)
  conductor: 4/8 confirmed (50%)
  fx: 1/3 confirmed (33%)
```

**Why:** Rut detection currently looks at 3-entry window. This gives strategic perspective
across the full evolution arc. Dimension-rut is new: catches when we mine the same
emergentMelodicEngine dimension repeatedly while leaving others untouched.

**Dimension:** New tool in evolution_next.py, ~100 lines. Parses journal.md + KB tags.

---

## E4 — Musical language in suggest_evolution

**What:** Replace dry correlation outputs with musical role descriptions.

**Before:** "E1: convergenceHarmonicTrigger (pull 0.52) — path crossLayer/harmony/..."

**After:**
```
### E1: convergenceHarmonicTrigger
**Musical role:** Harmonic resolution gateway. Gates melodic arrival at cadence points —
when it fires, voices are pulled toward harmonic consonance. Currently uncoupled: the
emergent melody's contour direction has no influence on whether harmonic resolution opens.

**Coupling pattern:** `safePreBoot → melodicCtx?.counterpoint` multiplier on gate threshold
**Cluster pull:** 0.52 (7 coupled partners orbit this module)
**What changes if you couple it:** cadence points will flex with melodic tension —
rising counterpoint suppresses resolution, falling contour amplifies it.
```

**How:** Read module's KB entries + narrative-digest.md mentions + TUNING_MAP.md for
role description. Use `_get_compositional_context()` which already exists.

**Dimension:** Modify suggest_evolution output assembly in evolution_next.py, ~40 lines.

---

## E5 — perceptual_intent_loop HME tool

**What:** Read run-history snapshots to track CLAP section character across consecutive
runs, showing whether the perceptual feedback loop is converging or oscillating.

**Output:**
```
## Perceptual Intent Loop (last 5 runs)

Section 3:
  run-42: alien=0.72 organic=0.31 → intent: suppress alien (-0.06 density)
  run-43: alien=0.65 organic=0.38 → intent: suppress alien (-0.06 density)
  run-44: alien=0.61 sparse=0.44  → intent: diversify (sparse emerging)
  run-45: alien=0.55 sparse=0.52  → LOOP CONVERGING (alien dropping, sparse rising)

Section 7:
  run-42..45: alien stable 0.70-0.73 → intent nudge not taking effect
  → LOOP STALLED (4 consecutive runs with no character shift)
```

**How:** Read `metrics/run-history/` snapshots for `encodec_sections[sec].clap` fields.
Compare consecutive runs per section. Detect convergence (monotone change), oscillation
(reversals), stall (< 0.03 change over 4 runs).

**Dimension:** New tool in perceptual.py, ~120 lines. Reads run-history directory.

---

## Sequencing Notes

Priority order (highest leverage first):
1. E1 (crossLayerClimaxEngine) — unlocks analytics for highest-trust invisible module
2. E2 (drama_map) — closes the "where is it alive?" gap; validates R61/R62 work
3. E4 (musical language in suggest_evolution) — changes HOW we think about next round
4. E3 (evolution_momentum) — strategic view, good before R64 planning
5. E5 (perceptual_intent_loop) — requires clean run-history; implement last

After E1 is done: run pipeline, then use coupling_network to see if crossLayerClimaxEngine
now appears in cluster analysis. Expected to become #1 cluster pull target.

---

## Future Ideas (not yet scheduled)

- `trace_correlation_map`: sorted heatmap of all module pairs by |r|, reveals antagonists
- `what_changed_musically`: translate diff-compositions.json into prose musical description
- `music_characterize(section)`: all metrics → musical prose for a section
- Rhythmic coupling in suggest_evolution (currently only surfaces melodic candidates;
  47 rhythmically uncoupled modules exist)
