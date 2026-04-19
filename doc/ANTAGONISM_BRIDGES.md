# Antagonism Bridges

A *design primitive* used once in the music engine (`convergenceHarmonicTrigger ↔ verticalIntervalMonitor` via `densitySurprise`) and generalizable to any domain with competing forces.

## The principle

When two modules have a strong negative correlation (r ≤ -0.4 over a reasonable window), they are *measuring the same underlying axis from opposite sides*. The prescription:

1. **Do not decouple them.** The negative correlation is information.
2. **Find the shared upstream.** What real variable do they both respond to?
3. **Couple both to that upstream, with opposing responses.** One rises, the other falls, driven by the same signal.

What this achieves: the destructive interference becomes a productive tension. A single upstream change drives both sides of a now-coherent dynamic. No manual balance knob. The antagonism *is* the structure.

## The archetypal bridge

```
convergenceHarmonicTrigger ┐
                              ├ densitySurprise (shared upstream)
verticalIntervalMonitor    ┘

convergenceHarmonicTrigger: rarity *= f(densitySurprise)   ↑ with surprise
verticalIntervalMonitor:     penalty *= g(densitySurprise) ↑ with surprise

→ Surprise events produce MORE harmonic changes AND STRICTER collision
  discipline. Same signal, opposite effects. Richness + discipline
  co-produced rather than traded off.
```

Documented historical r = -0.626. Current r does not appear in the top-8 negative correlations (see `metrics/hme-suspected-upstreams.json` → `confirmed`) — the bridge is likely resolving the antagonism successfully.

## Recognizing candidates

Run `scripts/detect-antagonism-candidates.py`. It computes pairwise Pearson correlation across 27 trust-system scores in `metrics/trace.jsonl`. Any pair with r ≤ -0.4 is a *candidate* bridge — two modules may be measuring the same axis antagonistically.

Output goes into `metrics/hme-suspected-upstreams.json` under `candidates`. Each candidate has:

- `pair`: the two modules
- `r`: current correlation coefficient
- `hypothesized_upstream`: the named variable you suspect is the shared axis
- `proposed_opposing_responses`: what each side's response should be
- `falsifier`: what would prove the hypothesis wrong

## The epistemological move

The principle generalizes beyond the music engine. It is, at core, an epistemological instruction:

> **Whenever you observe tension between two things, you haven't yet identified what both sides are actually measuring.** The presence of tension is evidence of a shared upstream variable you haven't named.

Applied this way, it becomes a universal prompt for design review. Every pair of competing forces in the codebase — in any system — is a candidate bridge:

- **HME layer** — streak sensitivity ↔ signal trust, coupled to resolution velocity. See `tools/HME/activity/streak_calibrator.py`. First non-music bridge.
- **Evolution loop** — exploration ↔ exploitation, coupled to uncertainty (not yet bridged)
- **Context chain** — rotation ↔ compaction, coupled to coherence velocity (not yet bridged)
- **Agent ↔ user** — proactivity ↔ guidance density, coupled to task altitude (not yet bridged; often felt in practice)
- **Verdict space** — STABLE/EVOLVED/LEGENDARY/DRIFTED as polar `(distance, direction)` with `listener_appetite` as the shared upstream (see `scripts/verdict-polar.py`)

## When NOT to bridge

Not every negative correlation is a bridge candidate. Exclude:

- **Coincidental negatives** — two modules that happen to move opposite for reasons unrelated to a shared axis. Set a `falsifier` and wait several runs to confirm the pattern persists.
- **Zero-sum budget splits** — two modules that share a fixed budget and thus move opposite by construction (e.g., two axes of a unit-simplex softmax). These are accounting artifacts, not bridges.
- **Already-bridged pairs** — if the correlation is near-zero in current data but the comment history shows it was previously strong, the existing bridge may be working. Check `confirmed` in the registry before adding.

The `refuted` bucket in the registry is where hypotheses go when evidence disconfirms them. Writing down a refuted hypothesis prevents future rediscovery of the same dead end.

## Files

- `scripts/detect-antagonism-candidates.py` — correlation scanner over trace data
- `metrics/hme-suspected-upstreams.json` — registry of candidates / confirmed / refuted
- `tools/HME/activity/streak_calibrator.py` — first HME-layer bridge implementation
- `scripts/verdict-polar.py` — verdict-space polar reformulation (`distance × direction`)

## Related project principles

- CLAUDE.md's "Hypermeta-First" rule — don't hand-tune meta-controller constants. Antagonism bridges operationalize this by making the controller's input *derive from observation* rather than author intuition.
- `metrics/feedback_graph.json` — documents all known feedback loops. Bridge candidates surface loops that *should exist* but don't.
