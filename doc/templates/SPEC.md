# Polychron Active SPEC

> Canonical project spec for the current initiative. Agents read this file
> before planning and update it with `doc/templates/TODO.md` when a change
> materially moves the initiative.
>
> Stable project context lives in [doc/HME.md](../HME.md),
> [doc/SRC.md](../SRC.md), [doc/hme_full.md](../hme_full.md),
> [doc/src_full.md](../src_full.md), [README.md](../../README.md), and
> [CLAUDE.md](../../CLAUDE.md). This SPEC is for time-bounded work, not
> durable architecture.
>
> Completed sets archive to [tools/HME/KB/devlog/](../../tools/HME/KB/devlog/).
> The hidden HME todo archive bridge owns reset; do not manually reset SPEC/TODO
> to fake closure.

## Goal

<One paragraph naming the current initiative, why this set exists, and what
done means.>

## Architecture / Stack

- `<subsystem>`: <one-line touchpoint>
- `<state or data file>`: <one-line touchpoint>
- `doc/templates/SPEC.md` + `doc/templates/TODO.md`: active initiative plan and
  cross-turn queue.

## Phases

### Phase 0: <next initiative name>

<One paragraph of context for this phase.>

- [ ] [E2] First item of the initiative.

## Deferred To Next Cycle

<!-- Populate only with work intentionally excluded from this set. -->

## Deferred / Out Of Scope

<!-- Populate only with work explicitly rejected for this set. -->

## How This File Evolves

- Close an item by flipping `- [ ]` to `- [x]` in the same commit as the change.
- When all items in a phase are complete, add a short `_Phase N complete_`
  paragraph with evidence.
- New work discovered mid-cycle goes to `doc/templates/TODO.md` under
  "Next up"; promote it to a SPEC phase only when it belongs to the current
  initiative.
- Do not duplicate durable architecture here. Link to the core docs instead.

## Worthiness Gate

Score each candidate phase before adding it. If the total is below 6/12, put it
in TODO or drop it.

| Axis | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| priority alignment | unrelated | tangential | aligned | central |
| criticality | nice-to-have | can wait | needed this cycle | blocks work |
| simplicity | new abstraction | adds dependency | reuses surface | strict subset |
| evidence | none | one-off | reproducible | failing test or bug report |

Add the score to the phase header as
`### Phase N: <title> (worthiness P/C/S/E = N/N/N/N)`.

## Archive On Set Completion

A set is archive-eligible when every phase has zero open `- [ ]` items and a
`_Phase N complete_` sentinel paragraph. The archive bridge snapshots SPEC and
TODO to a devlog file, resets active SPEC/TODO to fresh templates, and extracts
learned patterns.

## Difficulty Labels

Every open SPEC item and every TODO "Next up" entry carries a leading
difficulty label:

- `[E1]` trivial, inline, low effort.
- `[E2]` mechanical and bounded.
- `[E3]` substantial multi-step work.
- `[E4]` cross-file or architectural work.
- `[E5]` comprehensive sweep or high-risk refactor.

Closed items do not need labels.

## Empty-Queue Bail

When TODO "Next up" is empty, every SPEC item is checked, and the user gave no
specific task, the dev cycle exits cleanly with:

```text
[no-work] <one-line reason>
```
