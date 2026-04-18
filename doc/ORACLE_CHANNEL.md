# The Oracle Channel

A *design primitive* used once in Polychron as the human-listening verdict log (`metrics/hme-ground-truth.jsonl`) and generalizable to any system that must improve itself without being able to evaluate itself.

## The principle

A self-improving system cannot bootstrap its own quality. Every internal metric it optimizes is vulnerable to Goodhart's law — push on the metric long enough and it drifts from the thing the metric was supposed to proxy. The escape is exactly one asymmetric channel whose signal the system cannot forge:

1. **External** — the signal's source is not part of any feedback loop the system controls.
2. **Append-only** — past verdicts cannot be rewritten. No Ministry of Truth.
3. **Attributed** — each verdict carries provenance (who, when, under what context).
4. **Structured for later analysis** — the format is designed for querying, correlation, and drift detection, not just human reading.

What this achieves: the system acquires a ground signal it cannot fake. Every internal controller can be evaluated *against* the oracle channel, so drift between proxy metrics and real quality is detectable rather than silent.

## The archetypal instance

`metrics/hme-ground-truth.jsonl` — human listening verdicts, one JSON object per line.

```
{"ts":1776275820,"ts_iso":"2026-04-15T17:57:00Z","section":"S3",
 "moment_type":"convergence","sentiment":"compelling",
 "comment":"The convergence moment at around 2:30 into section 3 was the most compelling part...",
 "round_tag":"R95","provenance":"human_ground_truth"}
```

Every required property is structurally enforced:

- **External:** `sentiment` and `comment` come from the human listener. The system has no aesthetic oracle of its own — it generates music but cannot judge it.
- **Append-only:** written via `>>` from `i/learn action=ground_truth`. No update path. Past rounds' verdicts are frozen.
- **Attributed:** `provenance: human_ground_truth`, plus `ts_iso` (when), `round_tag` (which generation), `section`/`moment_type` (what part of the piece).
- **Structured:** JSON lines. 9 downstream consumers treat it as a typed stream: `compute-kb-trust-weights.py` reweights the KB, `compute-coherence-budget.js` recalibrates the target band, `derive-constitution.py` extracts aesthetic invariants, `ground_truth.py` serves queries, `proxy/context.js` surfaces the latest verdict to the agent at turn start, etc.

One file. Nine consumers. The entire trust ecology and coherence-budget calibration descends from it.

## Recognizing what needs an oracle

Any subsystem that *self-optimizes against a metric it also computes* has a Goodhart vulnerability. The test:

> "If I optimized this metric to 1.0, would I be happy with the resulting system?"

If the honest answer is "no, I'd be happy with the system the metric was *supposed* to reflect" — the system is short an oracle channel. The metric has drifted or is about to.

Examples from this project that currently *do* have oracle grounding:

- **Coherence budget** (`metrics/hme-coherence-budget.json`) is calibrated against human verdicts, not against its own history. When LEGENDARY verdicts arrive, `compute-coherence-budget.js` re-fits the band. Without the oracle, the budget would converge to whatever the system most often produces — a tautology.
- **KB trust weights** come from `compute-kb-trust-weights.py`, which reads the oracle log and upweights entries cited in rounds with positive verdicts. The KB's sense of "what works" is grounded in external judgment, not internal confidence.

Examples from this project that probably need an oracle and don't have one:

- **Pipeline verdicts** (`STABLE`, `EVOLVED`, `DRIFTED`) are computed by `fingerprint-comparison` against the pipeline's own fingerprint history. The system evaluates itself against itself. If the fingerprint function drifts, the verdicts drift with it — invisibly. An oracle channel here would be periodic human-labeled "this is what EVOLVED looks like" samples; currently absent.
- **HCI trajectory** (`analyze-hci-trajectory.py`) computes the health arc from the system's own tool-effectiveness log. No external anchor. If the HME layer agrees with itself that it's healthy, nothing contradicts it.
- **Invariants themselves** fire based on counts and patterns in the codebase. The claim "this invariant catches real problems" is unaudited — we don't record whether firings correlate with actual fixes or with ignored warnings. The invariant-gardener idea from earlier in the session was partially about this.

## The epistemological move

The deepest form:

> **Every self-optimizing system is either oracle-fed or drifting.** If you cannot name the external signal that grounds your system, you are either (a) optimizing toward a proxy metric that will eventually diverge from what you care about, or (b) already diverging and don't know it.

This is universal:

- **ML training** — validation set is the oracle, external to training.
- **Product metrics** — customer interviews are the oracle, external to analytics.
- **Code review** — external reviewer is the oracle, external to author.
- **Democracies** — elections are the oracle, external to government.
- **Scientific theories** — experiment is the oracle, external to theory.

Every durable self-improving system has this structure. Systems that lack it collapse into self-reference: a committee that grades its own work, an algorithm that trains on its own outputs, a government that counts its own votes.

The corollary: **the oracle channel is the most valuable resource in the system, and should be treated as such**. In Polychron, human listening time is scarce. Each verdict in `hme-ground-truth.jsonl` is worth more than any number of auto-computed metrics. Protecting the oracle means:

- Not polluting it with low-quality signal (synthetic verdicts, automated scores)
- Never rewriting or deleting past entries
- Preserving context so old verdicts remain interpretable as the system evolves
- Making it trivially easy to add a verdict (low friction keeps the channel alive)

## When NOT to add an oracle

Oracles have a cost: they require actual human time or another scarce external judgment. Don't add one for:

- **Things measurable internally without drift risk.** Checksums, parse validity, syntax correctness — these have definitional ground truth. They don't need an oracle because there's no proxy gap.
- **Short-lived optimizations.** A one-off tune-up of a specific constant doesn't need oracle grounding if it'll be discarded before Goodhart has time to work.
- **Deterministic verifiable computations.** If the answer has a proof, the proof is the oracle.

The heuristic: **oracles earn their cost whenever a metric is a proxy for a value the system cannot compute directly**. Aesthetic quality, user satisfaction, "is this the right architecture" — these need oracles. Mechanical correctness does not.

## Oracle hygiene

A few specific disciplines Polychron gets right and any system using this primitive should follow:

- **One canonical location.** The oracle channel lives in exactly one path. Copies are derivatives; the source is the truth. Avoid fragmentation into "dev ground truth" vs. "prod ground truth" etc. — one channel per concept.
- **Schema evolution is append, never rewrite.** If the schema changes (new field), old entries get the default (or explicit null). Old entries never get the new field retroactively imputed; that fakes attribution.
- **Provenance is first-class.** The `provenance: human_ground_truth` tag lets consumers distinguish oracle signal from synthetic or inferred signal that might accumulate alongside it. Without provenance, the channel eventually gets poisoned by inferred entries and loses its oracle status.
- **Readers are many, writers are few.** The oracle log has 9+ consumers and one writer path (`i/learn action=ground_truth`). This asymmetry preserves integrity.

## Files

- `metrics/hme-ground-truth.jsonl` — the oracle channel
- `tools/HME/mcp/server/tools_analysis/ground_truth.py` — query/ingest API
- `tools/HME/mcp/server/tools_analysis/learn_unified.py` — the one writer path (via `i/learn action=ground_truth`)
- `scripts/pipeline/hme/compute-kb-trust-weights.py` — KB reweighting consumer
- `scripts/pipeline/hme/compute-coherence-budget.js` — band calibration consumer
- `scripts/pipeline/hme/derive-constitution.py` — aesthetic-invariant extractor
- `tools/HME/proxy/context.js` — surfaces latest verdict at turn start

## Related project principles

- CLAUDE.md's "Hypermeta-First" rule — meta-controllers own their axes, but meta-controllers still need oracle grounding to know whether their axis definitions match listener-perceived reality.
- [doc/ANTAGONISM_BRIDGES.md](ANTAGONISM_BRIDGES.md) — the structural complement. Antagonism bridges convert internal tension into structure; oracle channels convert external judgment into signal. Together they describe how a self-improving system gains its direction: one from within (which tensions to harness), one from without (which direction is good).
