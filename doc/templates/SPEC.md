# Polychron Active SPEC

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; reset back to "Polychron Active SPEC" after `i/todo clear` archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](../HME.md), [doc/ARCHITECTURE.md](../ARCHITECTURE.md), [README.md](../../README.md), and [CLAUDE.md](../../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../../tools/HME/KB/devlog/) -- each `i/todo clear` (when all phases are checked + sentinel-marked) timestamps the SPEC+TODO state into a single devlog file and resets the active doc to a fresh-slate template.

_Previous set (archive_now-test) archived 2026-05-03T162542Z to tools/HME/KB/devlog/2026-05-03T162542Z-archive_now-test.md._

## Goal

<One paragraph naming the current initiative -- what's being built or fixed, for whom, and why this set is grouped together. Should change at every set boundary.>

## Architecture / stack (one-liner each, current-initiative-relevant)

<Bullet the architectural touchpoints THIS initiative interacts with. Stable cross-initiative architecture lives in doc/ARCHITECTURE.md and CLAUDE.md; don't restate here.>

- <subsystem>: <one-line>
- <data dir / queue / manifest>: <one-line>
- <handoff doc>: doc/templates/SPEC.md (canonical phases) + doc/templates/TODO.md (3-section: In flight / Just shipped / Next up)

## Phases

### Phase 0: night-market-borrow

Three quality gates from claude-night-market that fill specific Polychron gaps. (1) Test-first enforcement (no implementation Edit/Write without a corresponding test file; analog to imbue's Iron Law). (2) Identity-leak + bare-stub + unbacked-claim scanner for KB devlog and doc/ writes (subset of scribe:slop-detector — vocabulary-density skipped, project prose is forensic not marketing). (3) CONSTITUTION.md root-level supreme-rules file with explicit override mechanism + amendment process, plus the additive-bias 4-question scrutiny added to CLAUDE.md.

- [x] [E3] PreToolUse `tdd_test_first_gate.py` -- block Write/Edit on `tools/HME/scripts/**.py`, `src/**.js` lacking a sibling `test_*.py` / `*.test.js`. Opt-in via `HME_TDD_GATE=1` (shadow-mode by default; warn on stderr without blocking). Skip files in `__pycache__`, `node_modules`, vendored dirs, and the existing exempt list.
- [x] [E3] Detector `slop_scan.py` -- registry-wired Stop-level detector. Three sub-checks on files Edit/Written this turn: (a) identity-leak P0 ("As a (large )?language model", "as of my training cutoff", "I cannot provide"), (b) bare TODO/FIXME without `(#NNN)` issue link, (c) evidence-backed-claims for `**/README.md` (production-ready/scalable/fast/secure/battle-tested without same-repo evidence ref). Wire as `slop_scan.py` in `tools/HME/scripts/detectors/`, register in `registry.json`, add `SLOP_SCAN_*` env knobs.
- [x] [E3] CONSTITUTION.md at project root with 6 rules adapted to Polychron (TDD floor, no bypass of quality gates, errors propagated, no identity leaks, evidence-backed claims, additive-bias defense). CLAUDE.md "Universal Principles" gains a `## Override mechanism` block linking to CONSTITUTION.md, plus a `## Additive-bias scrutiny` block with the 4 questions (priority alignment / criticality / simpler-exists / evidence).

_Phase 0 complete_ (2026-05-09T22:00:00Z):

Three targeted gates from claude-night-market integrated. (1) TDD test-first gate at PreToolUse blocks new impl files without sibling test (shadow-default, opt-in via HME_TDD_GATE=1) -- closes the "tests after the fact" failure mode. (2) slop_scan stop-level detector covers identity leaks (P0), bare TODO/FIXME without issue links, and unbacked claims in READMEs -- complements the existing speculation_debt scanner with vocabulary/identity-leak coverage we lacked. (3) CONSTITUTION.md at project root + CLAUDE.md override-mechanism block + additive-bias scrutiny -- formalizes the supreme-rules layer with explicit override mechanism the project's CLAUDE.md was missing. Files added: [tools/HME/scripts/tdd_test_first_gate.py](../../tools/HME/scripts/tdd_test_first_gate.py), [tools/HME/scripts/detectors/slop_scan.py](../../tools/HME/scripts/detectors/slop_scan.py), [CONSTITUTION.md](../../CONSTITUTION.md). Files edited: [tools/HME/hooks/pretooluse/pretooluse_edit.sh](../../tools/HME/hooks/pretooluse/pretooluse_edit.sh), [tools/HME/hooks/pretooluse/pretooluse_write.sh](../../tools/HME/hooks/pretooluse/pretooluse_write.sh), [tools/HME/scripts/detectors/registry.json](../../tools/HME/scripts/detectors/registry.json), [CLAUDE.md](../../CLAUDE.md). Verified end-to-end: TDD gate blocks new impl and passes existing files; slop_scan catches identity leak in test transcript; registry consistency check passes (23 bash_vars covered).

## Deferred / out of scope

- **Telegram bot + remote control** -- out of scope; HME use case is single-operator, no remote ops
- **A2A protocol** -- wrong problem class (cross-org/cross-framework opacity); HME's review-everything stance directly conflicts
- **Skills-as-bundles refactor** -- interesting but invasive; `i/*` registry is fit-for-purpose for now
- **JSON schema validation for chain YAML** -- Polychron has manifest validation; non-manifest configs (lab sketch metadata, hook chain ordering) could benefit but it's deferred until Phase 2 lands
- **Auto-promote tiers + sanitize gate** -- KB-to-shared-discoveries promotion is a separate workflow; revisit after Phase 2 stable

## Three-loop role separation (NEVER lists)

Per skill-set's chain-driver / chain-runner / supervisor jurisdiction discipline. Each loop has an explicit NEVER list -- actions outside its jurisdiction. Violations are framework bugs, not edge cases.

**Co-buddy (the workers -- `claude --resume <sid>`):**
- NEVER edit `doc/SPEC.md` or `doc/TODO.md` directly. Updates flow through `i/todo close_with_spec_update` (atomic flip+ship) or `i/todo promote_to_spec` (queue addition).
- NEVER make git commits. Autocommit-direct is the only writer.
- NEVER decide which item to pick. The dispatcher picks; the buddy executes.
- NEVER edit other buddies' processing/ files. Atomic-mv claim semantics own each task; cross-buddy peeking is a race.

**Dispatcher (`tools/HME/scripts/buddy_dispatcher.py`):**
- NEVER mutate task content. Reads JSON, routes, archives -- never modifies the payload.
- NEVER suppress a buddy's stderr. Errors land in `log/hme-errors.log` per the LIFESAVER chain.
- NEVER skip the verdict file. Every drain, including fast-path-clean, writes one.
- NEVER bypass the floor-based escalation. `effective = max(item_tier, buddy_floor)` per axis is the routing contract.

**Operator (humans + the agent at session-leader scope):**
- NEVER hand-edit `tmp/hme-buddy-queue/processing/`. Atomic claims live there; manual edits race the dispatcher.
- NEVER kill a buddy mid-task. Halt fires SIGINT between tasks (skill-set's "halt-best-effort-between-atomic-units" rule).
- NEVER skip the SPEC/TODO sync. The autocommit-guard surfaces drift; closing the loop on flagged drift is on you.
- NEVER add policy to the dispatcher to handle an outlier. The dispatcher is mechanism; policy belongs in `doc/SPEC.md`.

## Glossary (project-specific terms)

- **co-buddy**: one of N parallel persistent `claude --resume <sid>` sessions in the buddy fanout
- **task tier**: one of `[E1|E2|E3|E4|E5]` (legacy easy/medium/hard accepted, translated to E2/E3/E4); routes to a model+effort tier per the floor-based escalation rule
- **`[no-work]` sentinel**: stdout marker emitted by a co-buddy when its task is complete AND the queue is drained; positive idle declaration
- **iter-boundary drafts sweep**: self-healing scan of prior iter's `processing/` dir at start of next iter; consumes orphans from buddies that died mid-task
- **verdict file**: per-co-buddy-turn `buddy-<N>-verdict.md` recording task outcomes; required by the exit-contract gate
- **floor-based escalation**: `effective = max(item_tier, buddy_floor)` per axis (model and effort resolved independently); higher of (item-tier, buddy-floor) wins per axis

---

### How this file evolves

- A skill closes an item by flipping `- [ ]` -> `- [x]` in the same commit as the code change. Use `i/todo close_with_spec_update target=<id>` to do this atomically (also appends to `doc/TODO.md` Just shipped).
- When all items in a phase are checked, append a "completed" block via `i/todo phase_complete phase=<N> text="<1-paragraph result + bulleted file citations + test-count delta>"`. The completion paragraph is meaningful content authored by the closer -- not auto-generated.
- New work surfaced mid-cycle goes to `doc/TODO.md`'s "Next up", not directly here. The next cycle decides whether it merits a new spec phase or was actually a follow-up to the current one.

### Archive on set completion (KB devlog)

Diverges deliberately from skill-set's roll-forward design. Their model leaves completed phases stacked in the active SPEC.md (45KB+ over 20 phases) -- every skill that reads the spec end-to-end pays that context tax. Polychron archives whole sets to KB devlog instead.

**Trigger:** when ALL phases in `doc/SPEC.md` have zero open `- [ ]` items AND every phase carries its `_Phase N complete_` sentinel paragraph, the next `i/todo clear` action archives the set.

**Archive flow:**
1. Snapshot `doc/SPEC.md` + `doc/TODO.md` verbatim into a single timestamped file at `tools/HME/KB/devlog/<YYYY-MM-DDTHHMMSSZ>-<slug>.md` (slug optionally passed via `i/todo clear text="<set-name>"`)
2. Reset `doc/SPEC.md` Phase blocks to a fresh-slate Phase 0 placeholder with a pointer back to the devlog file
3. Reset `doc/TODO.md` to the empty 3-section template
4. Preamble (Goal / Architecture) and trailing sections (Glossary, Three-loop NEVER lists, Difficulty labels, Empty-queue bail) are preserved across the reset since they're stable across sets

**Mid-set:** if the set isn't complete (any open `[ ]` items remaining), `i/todo clear` just removes completed i/todo entries (the original behavior) -- no archive, no SPEC reset. The `clear` output surfaces what's still blocking archive.

The active doc/ directory thus stays lean; deeper history lives in the devlog and `git log`. Searching past sets: `grep -r "<keyword>" tools/HME/KB/devlog/` or any KB query that includes the devlog directory.

### Difficulty labels (model + effort routing)

Every open `- [ ]` SPEC item AND every `## Next up` TODO entry MUST carry a difficulty label as the leading bracket immediately after the `- [ ]` checkbox (or the leading `- ` for TODO entries). Five values (E1-E5); legacy easy/medium/hard accepted and translated:

- `[E1]` -> Haiku tier + low effort. Trivial, inline-call shape.
- `[E2]` -> Haiku tier + low effort. Mechanical, well-bounded. (legacy `[easy]` translates here)
- `[E3]` -> Sonnet tier + medium effort. Substantial reasoning, multi-step, structured. (legacy `[medium]`)
- `[E4]` -> Sonnet/Opus tier + high effort. Cross-file reasoning, architectural. (legacy `[hard]`)
- `[E5]` -> Opus tier + high effort. Comprehensive sweep, exhaustive cross-cutting refactor.

Resolution rule: `effective = max(item_tier, skill_floor)` per axis (model and effort independent).

Closed items (`- [x]`) and `## Just shipped` entries don't carry labels (historical).

### Empty-queue bail (steady state)

When `doc/TODO.md`'s "Next up" is empty AND every `- [ ]` in this spec has been flipped to `[x]` AND the user gave no specific task, the dev cycle exits 0 cleanly without picking an item. Before exiting it prints exactly one line on stdout:

```
[no-work] <one-line reason>
```

The dispatcher recognizes this sentinel and aborts the loop entirely. The iteration's manifest records `iter_manifest["no_work_bail"] = {"buddy": "<N>", "reason": "<sentinel-line>"}`; the top-level `manifest["loop"]["terminated_by"] = "no_work_bail"` distinguishes a bail from natural max-cycles completion or a real failure.
