# Polychron SPEC -- audit-driven-cleanup

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; the title resets to "Polychron Active SPEC" automatically when `i/todo clear` (auto on full-set complete) or `i/todo archive_now text="<slug>"` (force) archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](HME.md), [doc/ARCHITECTURE.md](ARCHITECTURE.md), [README.md](../README.md), and [CLAUDE.md](../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../tools/HME/KB/devlog/). DO NOT manually edit SPEC.md / TODO.md to reset between cycles -- run `i/todo clear` (auto-archives if complete) or `i/todo archive_now text="<slug>"` (force). The tools own the reset; manual edits race the auto-gen logic in tools/HME/service/server/tools_analysis/todo_spec_archive.py.

_Previous set (hme-buddy-observability) archived 2026-05-11T102328Z to tools/HME/KB/devlog/2026-05-11T102328Z-hme-buddy-observability.md._

## Goal

`bash scripts/audit-all.sh --strict` against the freshly-archived `hme-buddy-observability` set surfaced eight distinct findings ranging from active runtime defects (undefined symbol in `exhaust_check.py:327`, hook-coordination cycle) through pre-existing FAILs blocking HCI (HME.md tool-count drift, detector-chain corpus regressions) down to ASCII / LOC / doc-path hygiene. This initiative resolves them in severity order: P0 attacks runtime defects + their downstream regressions (import defect is likely root cause for ~half the corpus failures, fix that first then re-assess), P1 attacks the hook cycle + pre-existing HCI doc-sync FAILs, P2 attacks hygiene (LOC, em-dashes, doc-paths). Active execution-path defects outrank doc drift at any given severity tier.

## Architecture / stack (one-liner each, current-initiative-relevant)

- `tools/HME/scripts/detectors/exhaust_check.py` -- has unresolved `iter_tool_uses` ref at line 327 (added during hme-buddy-observability turn for `_has_tool_call_after_last_text`, the import was missed); also contains the structural-enumeration check that conflicts with the research-eval-exemption corpus fixture.
- `tools/HME/scripts/detectors/pile_on.py` -- corpus fixtures `two-detector-edits-fire` and `boundary-with-tool-results-fires` encode the OLD overreach behavior (any 2+ edits fires); current code is the user-mandated narrower form (>=2 NEW Writes only).
- `tools/HME/scripts/detectors/test_detector_chain.py` -- corpus that lives under `audit-all.sh --strict`; needs new fixtures matching the post-cleanup detector contracts.
- `tools/HME/hooks/lifecycle/sessionstart.sh` + `tools/HME/hooks/lifecycle/userpromptsubmit.sh` -- annotated coordination graph forms a cycle per `audit-hook-coordination`; either docstring is wrong or actual ordering needs decoupling.
- `tools/HME/hooks/lifecycle/stop/detectors.sh` -- references `$SENIOR_CONSULT_DEBT` at lines 39 + 44, variable never set (per `audit-shell-undefined`).
- `doc/HME.md` -- claims "12 tools, server has 13"; references nine detector names (advisor_doctrine, ceremony_dodge, live_probe, phantom_capability, phase_gate, scope_escape, senior_consult_debt, summary_format, trample_gate) under a tool surface that no longer exposes them as tools.
- `doc/templates/SPEC.md` (this file) -- relative-link references in its template body resolve to `HME.md` instead of `../HME.md` (5 broken refs per `audit-doc-integrity`).
- `tools/HME/proxy/supervisor/index.js` -- 355 LOC > 350 limit per `audit-loc`.
- `tools/HME/proxy/sse_rewriters.js` + `tools/HME/service/before-editing-cache.json` + `scripts/pipeline/generators/generate-manifest-globals.js` -- em-dash (U+2014) violations per `audit-no-non-ascii`.
- `<handoff doc>`: doc/templates/SPEC.md (canonical phases) + doc/templates/TODO.md (3-section: In flight / Just shipped / Next up)

## Phases

### Phase 0: detector regressions from prior session work (root-cause first)

Fix the runtime defects introduced by the just-archived set BEFORE updating corpus fixtures. The import defect at `exhaust_check.py:327` may be the proximate cause of multiple corpus failures (the detector crashes mid-run, the test framework records the failed verdict). Updating fixtures before fixing the import would encode broken behavior as the new baseline.

- [ ] [easy] (a) Add `iter_tool_uses` to `exhaust_check.py` line-34 import. This was a missing-import bug introduced when `_has_tool_call_after_last_text` was added in the prior turn -- detector currently crashes on the structural-enumeration path that uses it.
- [ ] [easy] (b) Re-run `bash scripts/audit-all.sh --strict` after (a). Reassess which of the 3 detector-chain corpus failures (`exhaust_check/research-eval-exemption`, `pile_on/two-detector-edits-fire`, `pile_on/boundary-with-tool-results-fires`) still fail. Document residual count inline here.
- [ ] [medium] (c) Update fixtures for genuine behavior changes (pile_on now requires 2+ NEW Writes, not 2+ Edits; exhaust_check now fires structural enumeration >=3 line-start list items in closing 60% unconditionally). Only touch fixtures that still fail after (a).

### Phase 1: active hook defects + pre-existing HCI FAILs

- [ ] [medium] (d) Resolve `sessionstart -> userpromptsubmit -> sessionstart` cycle reported by `audit-hook-coordination`. Either the MUST-RUN-BEFORE / COORDINATES-WITH docstring annotations are wrong (one of them shouldn't claim to coordinate with the other in a cycle-producing direction) or the actual runtime ordering needs decoupling. Read both docstrings + the chain-runner, decide which side resolves cleanly.
- [ ] [easy] (e) `$SENIOR_CONSULT_DEBT` shell-undefined in `tools/HME/hooks/lifecycle/stop/detectors.sh:39+44`. Either the var is set elsewhere in the chain (and detectors.sh should `source` the setter first) or the references are stale post-rename. Trace via `grep -rn "SENIOR_CONSULT_DEBT" tools/HME/hooks/`.
- [ ] [medium] (f) `doc/HME.md` doc-sync: align tool count (12 claimed vs 13 server-exposed) and remove the nine detector names misclassified as tools. Detectors are NOT tools -- they're stop-hook verdicts. Fix the documentation distinction.

### Phase 2: hygiene

- [ ] [easy] (g) Fix the 5 broken file refs in `doc/templates/SPEC.md` template body. From `doc/templates/`, references to `doc/HME.md` etc. need `../HME.md` prefix.
- [ ] [easy] (h) `tools/HME/proxy/supervisor/index.js` at 355 LOC: either extract a focused helper to bring back under 350 OR add to `config/loc-ignore.txt` with rationale (per CLAUDE.md, judgment call).
- [ ] [easy] (i) Replace em-dashes (U+2014) with `--` ASCII in `tools/HME/proxy/sse_rewriters.js` (3 sites) + `scripts/pipeline/generators/generate-manifest-globals.js` (1 site). `tools/HME/service/before-editing-cache.json` is generated/cache -- decide whether to add to ASCII-ignore or regenerate clean.

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
