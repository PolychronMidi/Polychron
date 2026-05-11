# Polychron Active SPEC

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; the title resets to "Polychron Active SPEC" automatically when `i/todo clear` (auto on full-set complete) or `i/todo archive_now text="<slug>"` (force) archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](../HME.md), [doc/ARCHITECTURE.md](../ARCHITECTURE.md), [README.md](../../README.md), and [CLAUDE.md](../../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../../tools/HME/KB/devlog/). DO NOT manually edit SPEC.md / TODO.md to reset between cycles -- run `i/todo clear` (auto-archives if complete) or `i/todo archive_now text="<slug>"` (force). The tools own the reset; manual edits race the auto-gen logic in tools/HME/service/server/tools_analysis/todo_spec_archive.py.

_Previous set (fp-fix) archived 2026-05-11T160931Z to tools/HME/KB/devlog/2026-05-11T160931Z-fp-fix.md._

## Goal

Onboarding coherence fixes surfaced during first-agent onboarding session. Two structural bugs: `_onb_init` treated a file containing "graduated" as permanently graduated, trapping new sessions in no-walkthrough mode; selftest emitted FAIL + `clear_index` prescription for partial-index states (chunks > 0, files < 100), baiting destructive clears when a plain reindex suffices.

## Architecture / stack (one-liner each, current-initiative-relevant)

- `tools/HME/hooks/helpers/_onboarding.sh`: session-start state init (`_onb_init`)
- `tools/HME/service/server/tools_analysis/evolution/evolution_selftest/selftest.py`: selftest label + fix hint map
- `tmp/hme-onboarding.state`: onboarding state file (single-line, deleted on graduation)
- `i/consult`: wrapper for buddy_handoff.py consult subcommand (kv passthrough)
- `tools/HME/hooks/helpers/buddy_init.sh`: SessionStart buddy spawn (writes log/hme-buddy-spawn.log)

## Phases

### Phase 1: Onboarding coherence fixes (worthiness P/C/S/E = 3/3/3/3)

- [x] Fix `_onb_init`: reset to boot every session; treat "graduated" file content as stale/absent
- [x] Reset stale `tmp/hme-onboarding.state` (was "graduated" since 2026-04-23)
- [x] Selftest: emit WARN (not FAIL) when chunks > 0 but files < 100; fix hint prescribes `action=index` first, not `clear_index`
- [x] Fix `i/consult` kv passthrough: strip leading dashes before re-prefixing `--`; `--engine=synthesis` now routes correctly (was `----engine=synthesis`)
- [x] `buddy_init.sh`: pre-log `spawn-init` line OUTSIDE the background subshell so a spawn that dies before launching still leaves a trace (LIFESAVER no-dilution)

_Phase 1 complete._ Five fixes shipped: `_onb_init` only preserves in-progress states (boot..verified); selftest partial-index path no longer baits destructive clear; `i/consult --engine=synthesis` works; buddy spawn attempts always logged. Files: `tools/HME/hooks/helpers/_onboarding.sh`, `tools/HME/service/server/tools_analysis/evolution/evolution_selftest/selftest.py`, `i/consult`, `tools/HME/hooks/helpers/buddy_init.sh`.

### Phase 2: Indexer + invariant + test follow-ups (worthiness P/C/S/E = 3/3/3/3)

- [x] Bump `HME_TOOL_HARDKILL_S` default-override to 600s in `.env` (was hitting 240s hard-kill on ~500-file index_directory)
- [x] Add consecutive-failure backoff to `watcher._do_dir_reindex` (doubles effective cooldown per failure, capped 8x)
- [x] Add regression test for `_onb_init` (5 tests: missing, "graduated", in-progress preservation, unknown). All pass.
- [x] Fix `hooks-executable` invariant: narrow glob to exec'd hook dirs (excludes sourced subscripts in helpers/safety/, lifecycle/stop/, pretooluse/bash/)
- [x] Fix `hooks-registered` invariant: same glob narrowing
- [x] Fix `eslint-rules-registered` invariant: exclude `*.test.js` (test files aren't registered rules)
- [x] Extend `_check_files_executable` + `_check_files_referenced` to accept either string or list of globs (new helper `_resolve_glob`)
- [x] Add `config/loc-ignore.txt` entries for `tools/HME/service/watcher.py` (lifecycle-cohesion) and `tools/HME/config/invariants.json` (declarative-config) -- both already exceeded 350 LOC pre-turn; my edits added <20 lines each
- [x] Fix `eslint-concordance-complete` invariant: exclude `*.test.js` from on-disk rule scan; add concordance entries for `no-bare-declared-global-in-init` and `no-or-fallback-on-map-get` (both `status=js_only`)
- [x] HCI display unification: `substrate-view.py` (i/status brief) now reads canonical `hci-verifier-snapshot.json` first (was preferring stale `pipeline-summary.json`). All four tools (i/state, i/status, i/holograph, selftest) now read same source.
- (moved to "Deferred / out of scope" -- off-theme for this infra-coherence SPEC)

_Phase 2 complete (10/10 in-scope items; composition-domain blindspot item moved to "Deferred / out of scope")._ Files: `.env`, `tools/HME/service/watcher.py`, `tools/HME/tests/specs/onboarding_init.test.js`, `tools/HME/config/invariants.json`, `tools/HME/service/server/tools_analysis/evolution/evolution_invariants/{_base,checks,checks_code}.py`, `config/loc-ignore.txt`, `scripts/hme/substrate-view.py`.

### Phase 3: Single-source-of-truth opportunities (worthiness P/C/S/E = 3/2/3/3)

Mirror of the HCI unification pattern from Phase 2: identify values/lists/configs the codebase reads from multiple disjoint locations, and consolidate to one authoritative source with the others becoming derivers. Each item carries the duplication evidence.

- [x] **Onboarding STATES list duplication.** Created `tools/HME/config/onboarding_states.json` as canonical. `_onboarding.sh` sources the list via `python3 -c "json.load(...)"` with hardcoded fallback for offline use. `onboarding_chain.py:STATES = _load_states()` reads from the same JSON.

- [x] **Watcher IGNORE_DIRS triple-source.** Removed the divergent fallback set in `watcher.py`; `file_walker.DEFAULT_IGNORE_DIRS` is now the single source (env -> builtin -> +gitignore). Watcher fails-fast on `file_walker` ImportError rather than maintaining a duplicate list.

- [x] **Difficulty-label translation.** Canonical translator already exists at `todo.py:_normalize_tier` (E1-E5 + legacy easy/medium/hard map). Fixed `todo_spec_phase.py:_NEXT_UP_RE/_SPEC_OPEN_RE` to accept E1-E5 (was matching legacy only -- silent miss on new-format entries). Other sites already import `_normalize_tier` or are descriptive (i_registry.json data, TEMPLATE.md doc).

- [x] **Invariant glob.glob() callers migrated to `_resolve_glob`.** `_check_glob_count_gte` and `_check_symbols_used` (checks.py:77, :131) both now use the helper. All glob-based invariants uniformly accept list-form globs.

- [x] **PROJECT_ROOT fallback chain.** Created `tools/HME/service/repo_root.py` with `resolve()` helper (3-tier: PROJECT_ROOT env -> CLAUDE_PROJECT_DIR env -> walk-up from `__file__`; raises if all fail). Migrated 9+ sites; host-specific path fallback removed everywhere. Sibling test `test_repo_root.py` (3 tests).

- [x] **Buddy SID location aggregator.** Created `tools/HME/scripts/buddy_registry.py` -- reads all 5+ dispersed SID stores (primary, legacy alias, multi-buddy slots, senior pool) and produces a unified `runtime/hme/buddy-registry.json` view. Existing writers stay authoritative (back-compat); readers can prefer the registry. Sibling test `test_buddy_registry.py` (3 tests).

- [x] **Pipeline verdict canonical.** `_nexus_get PIPELINE` (helpers/_nexus.sh) now reads from `output/metrics/pipeline-summary.json` directly (the true canonical source), with nexus cache as fallback. Verdict consumers no longer drift on stale cache.

- [x] **Comment-bloat thresholds in `.env`.** Added `COMMENT_BLOAT_WARN=3`, `COMMENT_BLOAT_FAIL=5`, `COMMENT_BLOAT_LONG_LINE=90` to `.env` -- both `pretooluse_edit.sh` and `scripts/audit-comment-bloat.py` already honored these env vars; centralizing the defaults in `.env` makes the SSOT explicit.

- [x] **i/* description drift warning.** `i/help` now extracts header comment for every script (registry-listed or not) and emits a `[drift] i/<name>: registry vs header disagree` stderr warning when both exist with materially different content. Registry remains canonical.

_Phase 3 complete: 9/9._ Files: `tools/HME/config/onboarding_states.json` (new), `tools/HME/hooks/helpers/_onboarding.sh`, `tools/HME/service/server/onboarding_chain.py`, `tools/HME/service/watcher.py`, `tools/HME/service/server/tools_analysis/todo_spec_phase.py`, `tools/HME/service/server/tools_analysis/evolution/evolution_invariants/checks.py`, `tools/HME/service/repo_root.py` (new), 9+ hardcoded-path migration sites, `tools/HME/scripts/buddy_registry.py` (new), `tools/HME/hooks/helpers/_nexus.sh`, `.env`, `i/help`, sibling tests `test_repo_root.py` + `test_buddy_registry.py`.

## Deferred to next cycle (ranked surfaces from this round's reviews)

<!-- Empty; populate per-cycle, auto-cleared on archive_now. -->

## Deferred / out of scope

- 3 overdue p1 blindspots (conductor/time/composers subsystems untouched 10 rounds, per `i/evolve` harvester). Composition-domain work -- off-theme for this infra-coherence SPEC. Tracked in TODO.md Next-up for a future composition-focused cycle.

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

**Trigger:** when ALL phases in `doc/SPEC.md` have zero open `- [ ]` items AND every phase carries its `_Phase N complete_` sentinel paragraph, the set is archive-eligible.

**To run the archive (DO NOT manually edit SPEC.md / TODO.md to reset; the tools own the reset):**
```
i/todo clear text="<set-slug>"            # auto-archives IF complete; mid-set just drops done entries
i/todo archive_now text="<set-slug>"      # force-archive regardless of phase state (use when set isn't formally complete but you need a snapshot)
```

Both invoke `_archive_set` in `tools/HME/service/server/tools_analysis/todo_spec_archive.py`, which performs the full flow atomically:

1. Snapshots `doc/templates/SPEC.md` + `doc/templates/TODO.md` verbatim into a single timestamped file at `tools/HME/KB/devlog/<YYYY-MM-DDTHHMMSSZ>-<slug>.md`
2. Resets `doc/templates/SPEC.md` Phase blocks to a fresh-slate Phase 0 placeholder with a pointer back to the devlog file
3. Resets `doc/templates/TODO.md` to the empty 3-section template
4. Auto-fires `learning_extract.py extract` to populate KB/learnings.jsonl with patterns from the just-snapshotted devlog
5. Preamble (Goal / Architecture) and trailing sections (Glossary, Three-loop NEVER lists, Worthiness gate, Difficulty labels, Empty-queue bail) are preserved across the reset since they're stable across sets

**Mid-set:** if the set isn't complete (any open `[ ]` items remaining), `i/todo clear` just removes completed i/todo entries -- no archive, no SPEC reset. The `clear` output surfaces what's still blocking archive.

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
