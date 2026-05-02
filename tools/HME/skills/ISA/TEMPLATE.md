---
slug: <one-word-slug>
phase: observe | think | plan | build | execute | verify | complete
tier: E1 | E2 | E3 | E4 | E5
created: <YYYY-MM-DDTHH:MM:SSZ>
updated: <YYYY-MM-DDTHH:MM:SSZ>
checkpoint: disabled
# Set checkpoint: enabled to opt this ISA into CheckpointPerISC auto-commits
# (tools/HME/scripts/isa/checkpoint_hook.py). When enabled, every [ ]->[x]
# transition fires one git commit referencing the criterion id, sidecar-state
# tracked at .checkpoint-state.json. Default disabled -- enable explicitly
# only when criteria are atomic enough that one commit per transition is
# meaningful, otherwise the per-turn autocommit is the right granularity.
---

# ISA: <one-line title>

> Ideal State Articulation. This document is simultaneously: (1) the
> articulation of done, (2) the test harness (ISCs ARE the tests, with
> named probes), (3) the build-verification artifact, (4) the done
> condition, and (5) the system of record for this work.
>
> Borrowed from PAI v6.3.0 (danielmiessler/Personal_AI_Infrastructure).
> See doc/ISA.md for Polychron-side conventions.

## Problem
<!-- What is broken / missing? Describe the current state in concrete
     terms -- symptoms, not diagnoses. Required at E2+. -->

## Vision
<!-- What does done feel like? Experiential intent -- euphoric surprise
     test: when this is right, the user will recognize it instantly.
     Required at E3+. -->

## Out of Scope
<!-- Anti-vision: what is NOT included. Each item bounds the work
     space. Required at E3+. -->

## Principles
<!-- Substrate-independent truths that bind the THINKING. Deutsch
     reach: would still apply if the implementation language changed.
     Required at E3+. -->

## Constraints
<!-- Immovable architectural mandates that bind the SOLUTION SPACE.
     Implementation-flavored ("must use the existing detector chain",
     "no new dependencies", etc.). Required at E3+. -->

## Goal
<!-- Hard-to-vary spine, 1-3 sentences. The single thing that must be
     true at the end. Required at all tiers. -->

## Criteria
<!-- Atomic ISCs. Each one is ONE binary tool probe. If you cannot
     name the probe, split further. Required at all tiers.
     Granularity rule: "split until each criterion is one binary tool
     probe."
     ID-stability rule: never renumber on edit. Splits become ISC-N.M.
     Drops become tombstones (`- [ ] ISC-N: [DROPPED -- see Decisions]`).
     Anti-criteria: at least one `- [ ] ISC-N: Anti: <what must NOT happen>`.
     Antecedents: at least one when goal is experiential.

     Status markers (one per criterion):
       [ ]                          unverified
       [x]                          verified by live probe
       [DEFERRED-VERIFY:<task-id>]  live probe genuinely impossible at
                                    execution time; the linked task carries
                                    the deferred verification claim and
                                    MUST close before the criterion can be
                                    re-marked [x]. Cannot bypass the gate.
-->

- [ ] ISC-1: <criterion>
- [ ] ISC-2: Anti: <what must NOT happen>

## Test Strategy
<!-- Per-ISC verification map. Each row: isc | type | check | threshold
     | tool. Required at E2+. -->

| ISC | type | check | threshold | tool |
|-----|------|-------|-----------|------|
| ISC-1 | live-probe | <command/inspection> | <pass condition> | Bash/Read/etc. |

## Features
<!-- Work breakdown: name | satisfies | depends_on | parallelizable.
     Required at E3+. -->

| feature | satisfies | depends_on | parallelizable |
|---------|-----------|------------|----------------|
| <name> | ISC-N | -- | yes/no |

## Decisions
<!-- Timestamped log. `refined: ...` for ISC tightening. `dead end: ...`
     for paths abandoned. `show your math: ...` when soft floors aren't
     met. Any phase. -->

## Changelog
<!-- Conjecture / refutation / learning / criterion_now format. Append
     via the LEARN phase. -->

- conjecture: <what we believed at THINK time>
- refuted_by: <evidence that broke it> (or `n/a`)
- learned: <what the refutation taught us>
- criterion_now: <how the ISC was sharpened in response>

## Verification
<!-- Evidence per ISC. One block per criterion at completion. Format:
     `ISC-N: <probe-type> -- <one-line evidence>`. -->

- ISC-1: <probe-type> -- <command output / read content / screenshot>
