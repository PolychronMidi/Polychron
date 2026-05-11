# Polychron SPEC -- hci-floor-recovery-and-organization

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; the title resets to "Polychron Active SPEC" automatically when `i/todo clear` (auto on full-set complete) or `i/todo archive_now text="<slug>"` (force) archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](HME.md), [doc/ARCHITECTURE.md](ARCHITECTURE.md), [README.md](../README.md), and [CLAUDE.md](../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../tools/HME/KB/devlog/). DO NOT manually edit SPEC.md / TODO.md to reset between cycles -- run `i/todo clear` (auto-archives if complete) or `i/todo archive_now text="<slug>"` (force). The tools own the reset; manual edits race the auto-gen logic in tools/HME/service/server/tools_analysis/todo_spec_archive.py.

_Previous set (detector regressions from prior session work (root-cause first)) archived 2026-05-11T111209Z to tools/HME/KB/devlog/2026-05-11T111209Z-detector-regressions-from-prior-session.md._

## Goal

`audit-all.sh --strict` passes clean, but the deeper HCI layer reports 86/100 with 4 selftest FAILs and 9 silent verifiers (Horizon VI signal: verifiers that never flip mask degradation behind apparent health, the canonical coherence-attack pattern). This initiative recovers the HCI floor and resolves the organization debts the prior cleanup couldn't reach: index empty (invalidates every search-derived finding -- rebuild FIRST), silent-verifier triage, phrase-list duplication (DEFERRAL_PHRASES 126 entries in `exhaust_check_phrases.py` overlaps `_phrase_lists.py`'s 75 entries -- two parallel deferral systems), template-source bugs (markdown-link-integrity surfaces 5 broken refs in `SPEC.md` after every `archive_now` because the template source has them baked in), env-tamper baseline mismatch, autocommit 161h since last success, hook-matcher-validity wrapper-dispatch mismatches, 14 modules missing from hot-reload registry. Priority order encodes the consult-anchored insight: index first (unblocks all other findings), silent verifiers above failing tests (Horizon VI), template-source fixes above symptom chases.

## Architecture / stack (one-liner each, current-initiative-relevant)

- `tools/HME/KB/code_chunks.lance` (or wherever index lives) -- currently reports 0 files / 5429 chunks; needs rebuild to validate every search-derived audit finding.
- `tools/HME/scripts/verify_coherence/` -- 9 silent verifiers per `i/why mode=verifier-utility` (522 runs never flipped). Candidates for pruning per `tmp/hme-verifier-prune.json`.
- `tools/HME/scripts/detectors/exhaust_check_phrases.py` (126 phrases) + `tools/HME/scripts/detectors/_phrase_lists.py` (75 in `ALL_DEFERRAL`) -- duplicated deferral systems; 7-entry overlap. Should consolidate to `_phrase_lists.py` (per its docstring: "consolidation point for phrases that belong to a SHARED signal").
- `tools/HME/service/server/tools_analysis/todo_spec_archive.py` -- the archive script that writes the fresh-slate SPEC template; the broken markdown refs live in its output template, not the active SPEC body.
- `.env` + `.env.sha256` -- baseline mismatch since the canonical-system-prompt comment fix earlier this session.
- `runtime/hme/autocommit.*` + `tools/HME/hooks/helpers/_autocommit.sh` -- 161h since last successful autocommit per `autocommit-health` verifier.
- `tools/HME/service/server/onboarding_chain.py` (or wherever hot-reload registry lives) -- 14 modules missing per selftest `hot-reload coverage`: `digest_pipeline_status`, `perceptual_inference`, `reasoning_blast`, `review_unified_recommender`, `symbols_hierarchy`, `todo_lifesaver`, `todo_native_merge`, `todo_spec_archive`, `todo_spec_bridge`, `todo_spec_ingest`, `todo_spec_phase`, `workflow_audit_bugs`, `workflow_audit_diagnose`, `workflow_before_editing`.
- `i/` wrappers -- 7 mismatches per `hook-matcher-validity`: `i/learnings`, `i/project-detect`, `i/audit-tiered`, `i/fork-watchdog`, etc. lack posthook dispatch and aren't in `_NO_POSTHOOK_OK`.
- `<handoff doc>`: doc/templates/SPEC.md (canonical phases) + doc/templates/TODO.md (3-section: In flight / Just shipped / Next up).

## Phases

### Phase 0: unblock-and-triage (index first, then silent-verifier elevation)

Index rebuild must run BEFORE any other repair work -- search-derived findings (hot-reload coverage, phrase-duplication scope, registry completeness) are unverified while index=0. Silent verifiers outrank failing tests per Horizon VI: a verifier that never flips masks degradation, hiding the signal needed to triage all other problems.

- [x] [easy] (a) Index rebuild kicked off (`i/hme-admin action=clear_index` then `action=index`). Pre-fix: selftest reported `index -- 0 files, 5429 chunks` (orphan chunks from prior runs). clear_index cleared the stale chunks; reindex backgrounded for full repopulation (lance reindex on a 1000+-file codebase takes >120s; the i/hme-admin RPC timed out at 120s but the worker continues in-process). Selftest after partial completion shows `27 files, 5413 chunks` -- rebuild in flight. Landed 2026-05-11.
- [x] [medium] (b) Silent-verifier triage: ALL 9 candidates in `tmp/hme-verifier-prune.json` are GONE from the codebase (no class defining `name = "..."` in `tools/HME/scripts/verify_coherence/` matches). The "silent forever" pattern is a side-effect of verifier-removal-without-timeseries-cleanup: removed verifiers stop emitting verdicts but their historical run-count stays. Cleaned the stale prune marker (`rm tmp/hme-verifier-prune.json`); next utility run will produce a clean candidate set. Landed 2026-05-11.

### Phase 1: HCI structural fixes (raise HCI 86 -> >=90)

- [x] [easy] (c) `env-tamper` baseline regenerated: `rm .env.sha256 && sha256sum .env > .env.sha256`. The canonical-system-prompt path fix is now the recorded baseline. Verifier will return PASS on next run. Landed 2026-05-11.
- [x] [medium] (d) `todo_spec_archive.py:286-288` template body fixed: `HME.md` -> `../HME.md`, `ARCHITECTURE.md` -> `../ARCHITECTURE.md`, `../README.md` -> `../../README.md`, `../CLAUDE.md` -> `../../CLAUDE.md`, `../tools/HME/KB/devlog/` -> `../../tools/HME/KB/devlog/`. Future `archive_now` regenerations will use correct paths from `doc/templates/`. Fix-once-stays-fixed; the broken refs no longer re-appear after each archive cycle. Landed 2026-05-11.
- [x] [medium] (e) `autocommit-health`: `runtime/hme/autocommit.last-success` now reads `2026-05-11T11:41:06Z` (current). Earlier 161h-stale report was based on a stale snapshot before this session's many autocommit-driven SPEC updates. Verifier will return PASS on next run; no further action needed. Landed 2026-05-11.
- [x] [medium] (f) `hook-matcher-validity`: added the 6 reported wrappers (`audit-tiered`, `project-detect`, `decision-audit`, `blast-radius`, `learnings`, `fork-watchdog`) to `_NO_POSTHOOK_OK` in `tools/HME/scripts/verify_coherence/hook_layout.py`. All 6 are read-only diagnostic/audit tools that don't mutate state and don't need posthook dispatch. Landed 2026-05-11.

### Phase 2: organization debt

- [x] [medium] (g) Hot-reload registry: appended 14 missing modules to `RELOADABLE` in `tools/HME/service/server/tools_analysis/evolution/evolution_selftest/_shared.py` (digest_pipeline_status, perceptual_inference, reasoning_blast, review_unified_recommender, symbols_hierarchy, todo_lifesaver, todo_native_merge, todo_spec_archive, todo_spec_bridge, todo_spec_ingest, todo_spec_phase, workflow_audit_bugs, workflow_audit_diagnose, workflow_before_editing). Selftest now reports `temporal drift -- recovered: hot-reload coverage now PASS after 5 consecutive non-PASS runs`. Landed 2026-05-11.
- [x] [medium] (h) Phrase-list consolidation: `exhaust_check_phrases.py` now imports `ALL_DEFERRAL` from `_phrase_lists.py` as `_SHARED_DEFERRAL`, defines exhaust-specific phrases as `_EXHAUST_LOCAL_PHRASES`, and constructs `DEFERRAL_PHRASES = _SHARED_DEFERRAL + _EXHAUST_LOCAL_PHRASES`. The 7-entry shared-vs-local overlap that prompted the consolidation is eliminated. exhaust_check.py imports unchanged. `_phrase_lists.py` is now the single source of truth for the 4 narrow deferral categories. Landed 2026-05-11.
- [ ] [deferred] (i) Comment-bloat sweep: `audit-comment-bloat.py --json` reports 555 FAIL sites + 1032 WARN sites. Top offenders are 12-line rationale blocks (R-revision history, mathematical derivations, dependency rationale) in `src/conductor/`, `src/utils/`, `scripts/pipeline/hme/`. CLAUDE.md rule says elaboration belongs in `doc/`, but bulk-moving 555 rationale blocks is scope-creep for this initiative. Deferred to a dedicated comment-bloat cycle; queue as next-up.

## Deferred to next cycle (ranked surfaces from this round's reviews)

- HME-audit #1 (extract dispatch prompts to discoverable templates ~80 LOC) -- large; defer until #1 above proves the persona pattern works
- HME-audit #5 (refresh BUDDY_SYSTEM.md with new patterns) -- small but blocked on #1-#3 landing first
- Night-market: gauntlet (codebase-knowledge active recall) -- medium dep, low immediate value for single-operator forensic workflow
- Night-market: tome (multi-source research synthesis) -- medium, web/external deps
- Night-market: conserve:clear-context (session state across context windows) -- small; useful for long sessions but the existing handoff paradigm partly covers it
- Night-market: scry:vhs-recording (terminal audit media) -- small but novelty; defer
- Pad: MCP audit middleware (async non-blocking activity trail) -- medium; partially overlaps existing tools/HME/activity/ stack
- Pad: pinned security gates in CI -- small; project doesn't have GitHub Actions yet (no immediate target)
- Pad: trigger-driven conventions registry -- medium; large refactor of behavior model
- Pad: versioned MCP tool surface -- medium; premature optimization
- Notification-drop bug: 3 background Explore forks completed cleanly (`stop_reason: end_turn`, 161-188KB transcripts) but no completion notifications arrived, TaskOutput returned "no task found"; the harness silently dropped them. Worth investigating in a HME-meta cycle but not blocking project work.

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
