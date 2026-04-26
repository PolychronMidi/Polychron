# Polychron Active SPEC

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; reset back to "Polychron Active SPEC" after `i/todo clear` archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](HME.md), [doc/ARCHITECTURE.md](ARCHITECTURE.md), [README.md](../README.md), and [CLAUDE.md](../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../tools/HME/KB/devlog/) — each `i/todo clear` (when all phases are checked + sentinel-marked) timestamps the SPEC+TODO state into a single devlog file and resets the active doc to a fresh-slate template.

## Goal

<One paragraph naming the current initiative — what's being built or fixed, for whom, and why this set is grouped together. Should change at every set boundary. Reset to a `<placeholder>` after archive; the next initiative's owner fills it in.>

## Architecture / stack (one-liner each, current-initiative-relevant)

<Bullet the architectural touchpoints THIS initiative interacts with. Stable cross-initiative architecture (the 18 hypermeta controllers, L0 channels, etc.) is documented in doc/ARCHITECTURE.md and CLAUDE.md; don't restate here.>

- <subsystem>: <one-line>
- <data dir / queue / manifest>: <one-line>
- <handoff doc>: doc/SPEC.md (canonical phases) + doc/TODO.md (3-section: In flight / Just shipped / Next up)

## Phases


_Previous set (skill-set integration sweep) archived 2026-04-26T174052Z to tools/HME/KB/devlog/2026-04-26T174052Z-skill-set-integration-sweep.md._

### Phase 0: <next set — name>

<1-paragraph context for the new set.>

- [ ] [easy] First item of the new set

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
