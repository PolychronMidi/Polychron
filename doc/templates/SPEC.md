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

### Phase 1: night-market-borrow-2

Two more night-market patterns that fill distinct Polychron gaps without piling on detectors. (1) `vow_bounded_reads` -- session-scoped counter on Read/Grep/Glob with budget; warns at threshold, resets on Edit/Write. Polychron has Bash polling guard but no Read/Grep/Glob ceiling, so multi-file exploration drifts unbounded. (2) `i/blast-radius` CLI tool -- git-diff + grep-based cross-file impact analysis; reports which other files import or reference symbols in the staged changes. No hook wiring, just an explicit query the agent runs before high-impact edits.

- [x] [E2] PreToolUse `vow_bounded_reads.py` -- session-scoped Read/Grep/Glob counter with `HME_READ_BUDGET` (default 15); reset companion fires on Write/Edit/MultiEdit; opt-in via `HME_READ_BUDGET_ENFORCED=1` (default warn-only). Stores counter in `tmp/hme-read-budget-<sid>.txt` with `fcntl.flock` for parallel-Read safety.
- [x] [E2] CLI `i/blast-radius` -- `tools/HME/scripts/blast_radius.py` runs `git diff --name-only`, extracts top-level identifiers (Python def/class, JS export), greps for those identifiers across `src/` + `tools/` + `lab/`, prints a ranked impact table (file:hits). Wire as `i/blast-radius` symlink in `i/`.

_Phase 1 complete_ (2026-05-09T22:30:00Z):

Two more night-market patterns landed without piling on detectors. (1) [vow_bounded_reads.py](../../tools/HME/scripts/vow_bounded_reads.py) wired into [pretooluse_read.sh](../../tools/HME/hooks/pretooluse/pretooluse_read.sh)/[_grep](../../tools/HME/hooks/pretooluse/pretooluse_grep.sh)/[_glob](../../tools/HME/hooks/pretooluse/pretooluse_glob.sh) (increment) and [_edit](../../tools/HME/hooks/pretooluse/pretooluse_edit.sh)/[_write](../../tools/HME/hooks/pretooluse/pretooluse_write.sh) (reset on action). Smoke-tested: counter increments 1->2->3->4 (warn at over-budget), enforced mode returns exit 2, --reset zeros to 0. (2) [i/blast-radius](../../i/blast-radius) -> [tools/HME/scripts/blast_radius.py](../../tools/HME/scripts/blast_radius.py); on the current changeset, surfaced 4 cross-file references to extracted identifiers in src/tools tree. No detector additions (PILE_ON discipline observed). Both opt-in/explicit so neither alters default agent behavior until invoked.

### Phase 2: spec-kit-auto-tasks-from-phase

spec-kit's `speckit-tasks` pattern adapted: extend `_ingest_from_spec` to optionally read `- [ ]` items directly from a `### Phase N` block in SPEC.md, eliminating the manual TODO.md "Next up" staging step. Default behavior (TODO.md "Next up") is preserved for back-compat; the new path is opt-in via `i/todo ingest_from_spec text="N"` or `text="latest"` (or `todo_id=N`).

- [x] [E3] Extend `_ingest_from_spec(meta, todos, phase=...)` in [todo_spec_ingest.py](../../tools/HME/service/server/tools_analysis/todo_spec_ingest.py): when `phase != 0`, read open `- [ ]` items from the matching `### Phase N` block via new helper `_read_phase_block`. Wire `phase` parameter through [hme_todo dispatch](../../tools/HME/service/server/tools_analysis/todo.py) (`text="N"` / `text="latest"` / `todo_id=N`). Re-export `_read_phase_block` from [todo_spec_bridge.py](../../tools/HME/service/server/tools_analysis/todo_spec_bridge.py). Update docstring per dir-intent doc-sync rule.

_Phase 2 complete_ (2026-05-09T22:45:00Z):

`_ingest_from_spec` now accepts `phase=N|"latest"`. Phase 0 (default) keeps the legacy TODO.md "Next up" path. Phase>0 walks the `### Phase N` block in [SPEC.md](../templates/SPEC.md), parses `- [ ] [tier] text` lines via existing `_SPEC_OPEN_RE`, dedups against open i/todo entries, materializes new ones with `(from SPEC Phase N)` provenance suffix. Smoke-tested `_read_phase_block(1)`, `_read_phase_block("latest")`, `_read_phase_block(99)` (returns []). Auto-flip hook from prior cycle handles the SPEC->TODO ship-line.

### Phase 3: night-market-followups-and-system-cleanup (worthiness P/C/S/E = 3/2/3/2)

Eight items: spinner-verb fix + 3 night-market borrows (B.1 tiered-audit, B.2 buddy_watchdog, B.3 worthiness checklist) + 4 internal optimizations (C.1 shared .env loader, C.2 stale soft-warn auditor exemption, C.3 reset-before-TDD reorder, C.4 birth-as-shipped auto-flip).

- [x] [E1] Spinner verbs: dropped trailing period from custom verb (sentence-form breaks "Cooked for 1m" duration template).
- [x] [E3] B.1 [tiered_audit.py](../../tools/HME/scripts/tiered_audit.py) + [i/audit-tiered](../../i/audit-tiered) -- multi-pass orchestrator over existing detectors; adds zero new rules. 5 passes: lint floor, marker registry, identity/slop, tests, README.
- [x] [E2] B.2 [buddy_watchdog.py](../../tools/HME/scripts/buddy_watchdog.py) -- transcript_missing -> clear primary pointer. Silence is NOT a failure signal (buddy primaries are sid pointers, not long-lived processes).
- [x] [E1] B.3 Worthiness gate appendix in [SPEC.md template](../templates/SPEC.md) -- 4-axis (priority/criticality/simplicity/evidence) 0-3 score per Phase; total <6/12 defers to TODO.md Next-up.
- [x] [E2] C.1 Extract shared .env loader to [tools/HME/proxy/shared/load_env.js](../../tools/HME/proxy/shared/load_env.js); [hme_proxy.js](../../tools/HME/proxy/hme_proxy.js) now requires it.
- [x] [E1] C.2 Refresh stale-soft-warn notes with concrete promotion criteria + add `Auditor exemption: non-temporal` marker for permanent soft-flags (advisor_silently_skipped, claim_without_evidence).
- [x] [E1] C.3 Reorder vow_bounded_reads --reset to fire BEFORE TDD gate in [pretooluse_edit.sh](../../tools/HME/hooks/pretooluse/pretooluse_edit.sh)/[_write.sh](../../tools/HME/hooks/pretooluse/pretooluse_write.sh) -- TDD-blocked attempts still break the read streak.
- [x] [E2] C.4 [spec_autoflip.py](../../tools/HME/scripts/spec_autoflip.py) now catches "birth-as-shipped" items (line is `[x]` in current AND didn't exist in HEAD), not just `[ ]→[x]` transitions.

_Phase 3 complete_ (2026-05-10T16:00:00Z):

All 8 items shipped + verified end-to-end. tiered-audit pass-3 surfaced 4 findings (mix of false-positives in CONSTITUTION.md self-quoting + 2 legitimate "fast" claims in READMEs). Buddy watchdog tested: now reports `no_primary` after I cleared a stale pointer during initial-version-too-aggressive design (fixed; silence is not a failure signal). Auditor exemption verified: 4-down-to-2 stale findings after refresh. Spinner-verb fix awaits next-session validation. Birth-as-shipped logic verified by re-running spec_autoflip on this turn's HEAD diff.

### Phase 4: whats-next-followups (worthiness P/C/S/E = 3/2/3/2)

Three actionable items from prior cycles' "what's next" sections; remaining 3 (thinking/spinner-verb/bounded-reads-promotion) are user-side observations.

- [x] [E1] Extend slop_scan skip-list to direct invocation: extracted [is_skipped_path](../../tools/HME/scripts/detectors/slop_scan.py) as a public helper; [tiered_audit.py](../../tools/HME/scripts/tiered_audit.py) calls it in pass 3 so CONSTITUTION.md / SPEC.md / TODO.md / slop_scan.py / CLAUDE.md no longer self-flag.
- [x] [E1] Auto-fire buddy_watchdog at SessionStart: appended to [sessionstart.sh](../../tools/HME/hooks/lifecycle/sessionstart.sh) after buddy_init; one-shot, silent on healthy, only logs when transcript missing.
- [x] [E1] Auto-fire audit_stale_soft_warns at SessionStart: appended to same hook; outputs to stderr only when "need review" findings exist (silent on clean).

_Phase 4 complete_ (2026-05-10T17:00:00Z):

Pass-3 false-positives went from 4 to 2 (CONSTITUTION.md self-quote no longer surfaces; remaining 2 are real unbacked-"fast" README claims). Watchdog reports `no_primary` (current state, no false action). Auditor at default 14d threshold reports 0 stale findings (refresh notes from Phase 3 set re-evaluate dates 2 weeks out). All three followups complete; the 8-item Phase 3 is now fully wired into the SessionStart loop.

### Phase 5: tighten-detector-precision-and-autoflip-race (worthiness P/C/S/E = 3/2/3/3)

Two items from Phase 4's "what's next": the bare-"fast" claim regex was matching legitimate CS terms (fail-fast, fast-reconvergence) as if they were marketing hype; the spec_autoflip hook was racing autocommit and finding no diff to act on.

- [x] [E1] Tighten `_CLAIM_RE` in [slop_scan.py](../../tools/HME/scripts/detectors/slop_scan.py) to require an intensifier prefix for "fast" -- `(blazing|lightning|super)[- ]?fast`. Bare "fast" is too broad; matches fail-fast / fast-reconvergence (CS terms, not hype).
- [x] [E2] Fix [spec_autoflip.py](../../tools/HME/scripts/spec_autoflip.py) race condition: when HEAD == working tree (autocommit captured this turn's edit), walk back to HEAD~1 for the pre-edit baseline. Removed orphan `_read_head_spec_legacy` helper.

_Phase 5 complete_ (2026-05-10T17:30:00Z):

Pass-3 now reports 0 findings (was 2 false positives; legitimate "fast reconvergence" + "fail-fast" no longer flagged). Race fix verified: `_read_head_spec()` correctly returns HEAD~1 content when HEAD == working tree. Common autocommit-races-spec_autoflip pattern resolved; multi-autocommit scenarios (when HEAD~1 also has the just-edited state) still fall through to manual ship-line.

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

### Worthiness gate (before adding a Phase)

Adapted from imbue:scope-guard:worthiness-scored. Score each candidate Phase against four axes BEFORE writing it. If the total is < 6/12, the work doesn't belong in SPEC.md yet -- defer to TODO.md "Next up" or drop. Pairs with CLAUDE.md additive-bias scrutiny (default answer to "should we add?" is no).

| Axis | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **priority alignment** | unrelated | tangential | aligned | central to current Phase chain |
| **criticality** | nice-to-have | could wait | needs to happen this cycle | blocks downstream work |
| **simplicity** | complex new abstraction | adds dependencies | reuses existing surface | strict subset of installed surface |
| **evidence** | none | one-off observation | reproducible / detector flagged | bug report + failing test |

Add the score to the Phase header as `### Phase N: <title> (worthiness P/C/S/E = N/N/N/N)` so future archive readers see the gate's verdict at a glance.

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
