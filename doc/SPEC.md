# Polychron HME Co-Buddy Fanout SPEC

> Canonical project spec for the co-buddy fanout integration. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/TODO.md`) in the same commit as any code change.

## Goal

Evolve `buddy_system` from one persistent peer into a small co-buddy team (2-3 buddies, each with `claude --resume <sid>` persistence) that drains a queued task dir. Tasks carry difficulty labels that route to the appropriate co-buddy by model tier. Adopt the highest-leverage patterns from [skill-set](https://github.com/toadlyBroodle/skill-set) for queue/sentinel/manifest/exit-contract/cross-cycle-handoff discipline. Preserve HME's existing review-everything stance and filesystem-IPC philosophy.

## Architecture / stack (one-liner each)

- Co-buddies: N parallel `claude --resume <sid>` long-lived sessions, each with own SID file
- Queue: `tmp/hme-buddy-queue/{pending,processing,done,failed}/` with atomic-mv claim semantics
- Routing: `[easy|medium|hard]` task labels → model-tier dispatch via `effective = max(item_tier, buddy_floor)`
- Handoff: `doc/SPEC.md` (canonical phases) + `doc/TODO.md` (3-section: In flight / Just shipped / Next up)
- Manifests: `tmp/hme-buddy-fanout/<run-id>/manifest.json` (per-run, `in_progress: true` flag, `terminated_by` field)

## Phases

### Phase 0: SPEC/TODO substrate bootstrap

Stand up the spec+todo handoff doc system as the first integration. Use it to track every subsequent pattern's landing — meta-bootstrap means we exercise the substrate on its first real workload.

- [x] [easy] Create `doc/SPEC.md` seeded with full Phase 0-2 plan
- [x] [easy] Create `doc/TODO.md` seeded with Next up = Phase 0 items
- [x] [easy] Add `tier` field to `i/todo` schema (default existing items to `"medium"`, new items accept `tier=easy|medium|hard`)
- [x] [medium] Add `i/todo action=ingest_from_spec` — read `doc/TODO.md` Next up, materialize each as an i/todo entry with `source="spec"` and `tier=<label>`
- [x] [medium] Add `i/todo action=promote_to_spec target=<id>` — move an ephemeral i/todo entry to `doc/TODO.md` Next up with a Reason cite
- [x] [medium] Add `i/todo action=close_with_spec_update target=<id>` — flip `doc/SPEC.md` `[ ]→[x]` if the i/todo item closes a spec item, append entry to `doc/TODO.md` Just shipped, mark i/todo done — atomic
- [x] [medium] Wire `sessionstart.sh` to read `doc/TODO.md` In flight section alongside `list_carried_over()` so handoff state surfaces at session start
- [x] [hard] Pre-commit / autocommit-guard rule: if `src/**` changed AND no existing-spec-item closure noted, require either `doc/SPEC.md` OR `doc/TODO.md` to change in the same commit (catches drift between work and canonical record)

### Phase 1: Co-buddy fanout

Spawn N co-buddies at SessionStart, dispatch queued tasks across them based on tier label.

- [x] [medium] Parameterize `BUDDY_COUNT=2` (or `3`) in `.env`; default to 1 when unset (back-compat with current single-buddy)
- [x] [medium] Extend `buddy_init.sh` to spawn N processes; each writes own SID to `tmp/hme-buddy-N.sid`
- [x] [medium] Create queue-dir scaffold `tmp/hme-buddy-queue/{pending,processing,done,failed}/` at SessionStart
- [x] [hard] Build dispatcher: scans `pending/`, atomically `mv` next file into `processing/<buddy-N>/`, dispatches via that buddy's SID, awaits sentinel, moves to `done/` (or `failed/` on non-zero exit)
- [x] [medium] Adopt `[no-work]` sentinel — buddy emits on stdout when its task completes AND queue dir is empty; dispatcher reads stdout until sentinel as positive idle declaration (closes the "response read prematurely" failure mode)
- [x] [medium] Per-run manifest at `tmp/hme-buddy-fanout/<run-id>/manifest.json` with `iterations: [...]`, `loop.terminated_by`, per-buddy `pid`/`sid`/`task_count`/`tier_distribution`
- [x] [medium] Floor-based escalation: each buddy declares `model-floor` and `effort-floor` in its config (tmp/hme-buddy-N.config); dispatcher computes `effective = max(item_tier, buddy_floor)` per axis

### Phase 2: Resilience + audit patterns

Adopt skill-set's operational discipline patterns once Phase 1 substrate is running.

- [x] [hard] Iter-boundary drafts sweep — when iter_N+1 starts, scan iter_N's `processing/` for orphans (buddy died mid-task), treat each as injected work item with prior-iter manifest as citation, route through current dispatch mode
- [x] [medium] Verdict-file exit contract — every co-buddy turn writes `tmp/hme-buddy-fanout/<run-id>/buddy-<N>-verdict.md`; dispatcher's exit gate verifies every dispatched task either has a verdict OR is named in `[deferred]` block
- [x] [medium] Citation-required-for-edit — co-buddies proposing KB entries / spec changes must cite the motivating transcript line (`<i>_<skill>.txt:<line>` or for buddies `tmp/hme-buddy-fanout/<run-id>/buddy-<N>-transcript.txt:<line>`)
- [x] [medium] Fast-path on clean — verifiers skip deep walk when all 4 cheap signals say clean (no prior escalation, all exit codes 0, transcript free of error keywords, no orphan drafts)
- [x] [medium] Manager-guidance file `tmp/hme-operator-guidance.md` — durable cross-run directive channel; next `i/review` reads as priming context
- [x] [easy] Three-loop NEVER lists — codify per-buddy jurisdiction in tier-specific buddy frontmatter (e.g. easy buddy never edits architecture-bearing files; hard buddy never deals with mechanical refactors)

## Deferred / out of scope

- **Telegram bot + remote control** — out of scope; HME use case is single-operator, no remote ops
- **A2A protocol** — wrong problem class (cross-org/cross-framework opacity); HME's review-everything stance directly conflicts
- **Skills-as-bundles refactor** — interesting but invasive; `i/*` registry is fit-for-purpose for now
- **JSON schema validation for chain YAML** — Polychron has manifest validation; non-manifest configs (lab sketch metadata, hook chain ordering) could benefit but it's deferred until Phase 2 lands
- **Auto-promote tiers + sanitize gate** — KB-to-shared-discoveries promotion is a separate workflow; revisit after Phase 2 stable

## Three-loop role separation (NEVER lists)

Per skill-set's chain-driver / chain-runner / supervisor jurisdiction discipline. Each loop has an explicit NEVER list — actions outside its jurisdiction. Violations are framework bugs, not edge cases.

**Co-buddy (the workers — `claude --resume <sid>`):**
- NEVER edit `doc/SPEC.md` or `doc/TODO.md` directly. Updates flow through `i/todo close_with_spec_update` (atomic flip+ship) or `i/todo promote_to_spec` (queue addition).
- NEVER make git commits. Autocommit-direct is the only writer.
- NEVER decide which item to pick. The dispatcher picks; the buddy executes.
- NEVER edit other buddies' processing/ files. Atomic-mv claim semantics own each task; cross-buddy peeking is a race.

**Dispatcher (`tools/HME/scripts/buddy_dispatcher.py`):**
- NEVER mutate task content. Reads JSON, routes, archives — never modifies the payload.
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
- **task tier**: one of `[easy|medium|hard]`; routes to a model+effort tier per the floor-based escalation rule
- **`[no-work]` sentinel**: stdout marker emitted by a co-buddy when its task is complete AND the queue is drained; positive idle declaration
- **iter-boundary drafts sweep**: self-healing scan of prior iter's `processing/` dir at start of next iter; consumes orphans from buddies that died mid-task
- **verdict file**: per-co-buddy-turn `buddy-<N>-verdict.md` recording task outcomes; required by the exit-contract gate
- **floor-based escalation**: `effective = max(item_tier, buddy_floor)` per axis (model and effort resolved independently); higher of (item-tier, buddy-floor) wins per axis

---

### How this file evolves

- A skill closes an item by flipping `- [ ]` → `- [x]` in the same commit as the code change. Use `i/todo close_with_spec_update target=<id>` to do this atomically (also appends to `doc/TODO.md` Just shipped).
- When all items in a phase are checked, append a "completed" block via `i/todo phase_complete phase=<N> text="<1-paragraph result + bulleted file citations + test-count delta>"`. The completion paragraph is meaningful content authored by the closer — not auto-generated.
- New work surfaced mid-cycle goes to `doc/TODO.md`'s "Next up", not directly here. The next cycle decides whether it merits a new spec phase or was actually a follow-up to the current one.

### Archive on set completion (KB devlog)

Diverges deliberately from skill-set's roll-forward design. Their model leaves completed phases stacked in the active SPEC.md (45KB+ over 20 phases) — every skill that reads the spec end-to-end pays that context tax. Polychron archives whole sets to KB devlog instead.

**Trigger:** when ALL phases in `doc/SPEC.md` have zero open `- [ ]` items AND every phase carries its `_Phase N complete_` sentinel paragraph, the next `i/todo clear` action archives the set.

**Archive flow:**
1. Snapshot `doc/SPEC.md` + `doc/TODO.md` verbatim into a single timestamped file at `tools/HME/KB/devlog/<YYYY-MM-DDTHHMMSSZ>-<slug>.md` (slug optionally passed via `i/todo clear text="<set-name>"`)
2. Reset `doc/SPEC.md` Phase blocks to a fresh-slate Phase 0 placeholder with a pointer back to the devlog file
3. Reset `doc/TODO.md` to the empty 3-section template
4. Preamble (Goal / Architecture) and trailing sections (Glossary, Three-loop NEVER lists, Difficulty labels, Empty-queue bail) are preserved across the reset since they're stable across sets

**Mid-set:** if the set isn't complete (any open `[ ]` items remaining), `i/todo clear` just removes completed i/todo entries (the original behavior) — no archive, no SPEC reset. The `clear` output surfaces what's still blocking archive.

The active doc/ directory thus stays lean; deeper history lives in the devlog and `git log`. Searching past sets: `grep -r "<keyword>" tools/HME/KB/devlog/` or any KB query that includes the devlog directory.

### Difficulty labels (model + effort routing)

Every open `- [ ]` SPEC item AND every `## Next up` TODO entry MUST carry a difficulty label as the leading bracket immediately after the `- [ ]` checkbox (or the leading `- ` for TODO entries). Three values:

- `[easy]` → Haiku tier + low effort. Mechanical, well-bounded.
- `[medium]` → Sonnet tier + medium effort. Substantial reasoning, multi-step, structured.
- `[hard]` → Opus tier + high effort. Novel design, cross-file reasoning, architectural decisions.

Resolution rule: `effective = max(item_tier, skill_floor)` per axis (model and effort independent).

Closed items (`- [x]`) and `## Just shipped` entries don't carry labels (historical).

### Empty-queue bail (steady state)

When `doc/TODO.md`'s "Next up" is empty AND every `- [ ]` in this spec has been flipped to `[x]` AND the user gave no specific task, the dev cycle exits 0 cleanly without picking an item. Before exiting it prints exactly one line on stdout:

```
[no-work] <one-line reason>
```

The dispatcher recognizes this sentinel and aborts the loop entirely. The iteration's manifest records `iter_manifest["no_work_bail"] = {"buddy": "<N>", "reason": "<sentinel-line>"}`; the top-level `manifest["loop"]["terminated_by"] = "no_work_bail"` distinguishes a bail from natural max-cycles completion or a real failure.
