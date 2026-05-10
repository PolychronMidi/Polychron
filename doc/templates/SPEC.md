# Polychron Active SPEC

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; reset back to "Polychron Active SPEC" after `i/todo clear` archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](HME.md), [doc/ARCHITECTURE.md](ARCHITECTURE.md), [README.md](../README.md), and [CLAUDE.md](../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../tools/HME/KB/devlog/) -- each `i/todo clear` (when all phases are checked + sentinel-marked) timestamps the SPEC+TODO state into a single devlog file and resets the active doc to a fresh-slate template.

_Previous set (night-market-followups) archived 2026-05-10T175310Z to tools/HME/KB/devlog/2026-05-10T175310Z-night-market-followups.md._

## Goal

Make the just-shipped specialist subagents (.claude/agents/{reviewer,documenter,tester}.md) actually load-bearing rather than orphan persona files, plus close the two open BUDDY_SYSTEM.md questions (concurrent consult races, senior expertise routing). Synthesized from three parallel Explore-agent reports surveying Pad reference / night-market plugins not-yet-harvested / HME-buddy friction; the HME audit specifically flagged that the specialists I just shipped have no wiring into `_dispatch_to_buddy()`.

## Architecture / stack (one-liner each, current-initiative-relevant)

- **buddy dispatch**: tools/HME/scripts/buddy_dispatch_lifecycle.py + buddy_dispatcher.py + buddy_handoff*.py -- modular routing/drain/lifecycle/chain/status/ratelimit
- **specialist registry**: .claude/agents/{reviewer,documenter,tester}.md -- markdown frontmatter + body, currently isolated from buddy dispatch
- **handoff state**: runtime/hme/buddy-primary.{sid,floor,effort_floor} + tmp/hme-buddy-seniors/<sid>.json (per-senior retire metadata, no expertise tags yet)
- **handoff docs**: doc/templates/SPEC.md (canonical phases) + doc/templates/TODO.md (3-section: In flight / Just shipped / Next up); doc/BUDDY_SYSTEM.md (paradigm reference)

## Phases

### Phase 0: wire-specialists-into-dispatch (worthiness P/C/S/E = 3/3/3/3)

The HME-audit fork surfaced that the specialist agents shipped last cycle (.claude/agents/{reviewer,documenter,tester}.md) are persona prompts with no dispatch wiring; `_dispatch_to_buddy()` in buddy_dispatch_lifecycle.py uses a generic hardcoded system prompt regardless of task source. This Phase wires persona inference + agent body loading + closes BUDDY_SYSTEM.md's two open questions (Q1 concurrent consult races, Q2 senior expertise routing). All four items independent enough that `i/parallel-detect` would group them as parallel-safe.

- [x] [E3] Add `_infer_persona(task) -> str` and `_load_persona(name) -> str | None` helpers in [buddy_dispatch_lifecycle.py](../../tools/HME/scripts/buddy_dispatch_lifecycle.py); replace the hardcoded system prompt at the `_dispatch_to_buddy` synthesis call site with `system = persona_system or _generic_system`. Persona inference reads task.source / task.text for keywords (review/test/doc/...) and returns matching agent name. Body extraction strips YAML frontmatter from .claude/agents/<name>.md.
- [x] [E1] Lock-free consult re-entrancy guard: ALREADY-IMPLEMENTED at [buddy_handoff_consult.py:122-152](../../tools/HME/scripts/buddy_handoff_consult.py) (Q7 resolution from prior cycle). The fork audit was wrong; verified-and-skipped this turn. BUDDY_SYSTEM.md Q1 was already closed.
- [x] [E3] Senior expertise tagging in [buddy_handoff.py](../../tools/HME/scripts/buddy_handoff.py): added `_infer_senior_expertise(sid)` scanning transcript for KB-CRYSTALLIZE titles + 18 keyword clusters (concurrency/cache/detector/dispatch/auto-flip/etc), top-5 by score. `_retire()` writes `expertise_topics` to senior metadata. Added `_pick_senior_for_question(question, seniors_dir)` in [buddy_handoff_consult.py](../../tools/HME/scripts/buddy_handoff_consult.py) ranking by keyword-in-question + consult activity; `cmd_consult` auto-routes when `--sid` omitted. `i/handoff status` displays top-3 expertise per senior in [buddy_handoff_commands.py](../../tools/HME/scripts/buddy_handoff_commands.py). Closes BUDDY_SYSTEM.md Q2.
- [x] [E2] [project_detect.py](../../tools/HME/scripts/project_detect.py) + [i/project-detect](../../i/project-detect): scans repo root for 11 manifest types (go.mod / package.json / Cargo.toml / pyproject.toml / Gemfile / pom.xml / build.gradle / composer.json / mix.exs / setup.py); emits JSON with detected language(s), test runner, build command. `--tag` mode prints one-line additionalContext for hook injection.

_Phase 0 complete_ (2026-05-10T19:30:00Z):

Specialist subagents from prior cycle now load-bearing in synthesis-path dispatch (4 keyword clusters route to reviewer/tester/documenter; default falls through to generic). Lock infrastructure verified pre-existing (saved 15 LOC of duplicate work). Senior pool now self-organizing by topic, `_infer_senior_expertise` scans transcripts for KB-CRYSTALLIZE titles + 18 keyword clusters; auto-route picks best-overlap senior when `--sid` omitted; `i/handoff status` shows top-3 topics per senior. `i/project-detect` correctly identifies Polychron as javascript (per package.json) and the `--tag` mode produces `[project-detect] lang=javascript | test=npm test` ready for UserPromptSubmit injection. Both BUDDY_SYSTEM.md Open Questions resolved.

### Phase 1: wire-built-but-orphan-tools (worthiness P/C/S/E = 3/3/3/2)

Phase 0 built capabilities but left several at "ready but not wired" state. Closing the loop on each: project_detect tag injection, learning_extract auto-fire on archive, claude-resume persona hint, fork_watchdog as defensive instrumentation against the silent-notification harness bug.

- [x] [E1] [project_detect.py](../../tools/HME/scripts/project_detect.py) `--tag` wired into [userpromptsubmit.sh](../../tools/HME/hooks/lifecycle/userpromptsubmit.sh) -- one-line `[project-detect] lang=X | test=Y` echo per prompt so subagents skip per-call stack inference.
- [x] [E2] [learning_extract.py](../../tools/HME/scripts/learning_extract.py) auto-fired in [_archive_set](../../tools/HME/service/server/tools_analysis/todo_spec_archive.py) right after fresh-slate reset -- each `i/todo archive_now` cycle now auto-extracts patterns from the just-snapshotted devlog into KB/learnings.jsonl without manual `i/learnings extract`.
- [x] [E2] Persona hint in claude-resume dispatch path: [buddy_dispatch_lifecycle.py](../../tools/HME/scripts/buddy_dispatch_lifecycle.py) prompt construction now prepends `[persona: <name>] Apply role guidance from .claude/agents/<name>.md to this task.` when `_infer_persona(task)` returns non-empty, complementing the synthesis-path system-prompt swap from Phase 0.
- [x] [E2] [fork_watchdog.py](../../tools/HME/scripts/fork_watchdog.py) + [i/fork-watchdog](../../i/fork-watchdog) defensive instrumentation against silent-notification harness bug: scans all per-session subagents/agent-*.jsonl, surfaces forks completed (stop_reason set) but in 60s..1h "notification_lost" window. Wired into [sessionstart.sh](../../tools/HME/hooks/lifecycle/sessionstart.sh) with stderr-on-finding-only output.

_Phase 1 complete_ (2026-05-10T20:00:00Z):

All 4 built-but-orphan capabilities now load-bearing. project_detect emits the tag at every UserPromptSubmit (smoke-tested: `[project-detect] lang=javascript | test=npm test`). learning_extract fires automatically when archive_set succeeds (via subprocess invocation post-reset). claude-resume buddies now receive per-task persona hints in the prompt body (synthesis path got system-prompt swap in Phase 0; resume path gets prompt-body hint here, since spawn-time prompt is fixed). fork_watchdog smoke-tested against 116 historical agent transcripts, 0 in the recent 60s-1h window means harness is healthy now (the 3 forks from earlier this session are past the 1h threshold so correctly excluded as historical). Existing-seniors expertise backfill skipped: 0 seniors currently in pool to backfill.

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
