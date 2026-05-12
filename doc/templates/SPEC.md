# Polychron Active SPEC

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; the title resets to "Polychron Active SPEC" automatically when `i/todo clear` (auto on full-set complete) or `i/todo archive_now text="<slug>"` (force) archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](../HME.md), [doc/ARCHITECTURE.md](../ARCHITECTURE.md), [README.md](../../README.md), and [CLAUDE.md](../../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../../tools/HME/KB/devlog/). DO NOT manually edit SPEC.md / TODO.md to reset between cycles -- run `i/todo clear` (auto-archives if complete) or `i/todo archive_now text="<slug>"` (force). The tools own the reset; manual edits race the auto-gen logic in tools/HME/service/server/tools_analysis/todo_spec_archive.py.

_Previous set (mode4) archived 2026-05-12T175754Z to tools/HME/KB/devlog/2026-05-12T175754Z-mode4.md._

## Goal

OVERDRIVE_MODE=5 just landed (registry-driven per-tier cascade from `config/models.json`). MODE=2/3/4 still coexist as hardcoded predecessor branches in `synthesis_reasoning.py`, the proxy/launcher/supervisor still gate only on `=4`, and several doc/comment sites enumerate modes 0..3 only. This set audits the MODE=5 surface for Design Pattern fixes and optimizations -- consolidating the elif-ladder Strategy violation, surfacing OCP/DRY drift introduced by adding each new mode, and verifying cross-cutting MODE-read sites are coherent.

## Architecture / stack (one-liner each, current-initiative-relevant)

- synthesis_reasoning.call: per-tier dispatcher; MODE=2/3/4/5 are four near-identical elif arms (`tools/HME/service/server/tools_analysis/synthesis/synthesis_reasoning.py:354-443`)
- config/models.json: 5-tier registry (`E1..E5`) with `manually_toprank` override and `cost_order` ranking
- hme_proxy.js MODE-gate: only MODE=4 triggers the main-agent swap (`tools/HME/proxy/hme_proxy.js:486`); MODE=5 must NOT swap
- supervisor / watchdog / launcher: `proxy-supervisor.sh:129`, `proxy-watchdog.sh:40`, `launcher/polychron-launch.sh:75` -- currently MODE=4-gated, audit for MODE=5 reachability
- verify_coherence/env_settings.py:98: OVERDRIVE_MODE-aware auth injection check
- handoff doc: doc/templates/SPEC.md (canonical phases) + doc/templates/TODO.md (3-section: In flight / Just shipped / Next up)

## Phases

### Phase 0: MODE=5 design-pattern consolidation (worthiness P/C/S/E = 3/2/3/3)

MODE=5 shipped functional but left four design-pattern smells: (1) the elif-ladder in `synthesis_reasoning.call` violates OCP (each new mode adds a branch), (2) MODE=2/3/4 may be degenerate one-element registry chains masquerading as separate logic, (3) several MODE-read sites enumerate {0,1,2,3} or {0,1,2,3,4} only and drift on each mode-bump, (4) `manually_toprank` promotes a `tier_score=4` model above `tier_score=5` in E5 -- verify intent. Sequencing: E1/E2 (trivial textual drift) parallel; E4 audit BEFORE E3 refactor and E5 collapse (E4's verdict gates whether E5 is "consolidate" or "document irreducibility"). Each item below carries a tier-appropriate prompt frame.

**E1 frame** -- pinpoint stale enumeration; one-line edit; no design judgment required.

- [x] [E1] Fix stale mode-enumeration comment at `synthesis_reasoning.py:354` ("0=cascade; 1=Opus-all; 2=Opus/Sonnet/cascade; 3=Opus/DSeek/cascade.") -- extend to cover MODE=4 (main-agent swap + DSeek tiers) and MODE=5 (registry-driven cascade).
- [x] [E1] Fix stale "Opus-then-Sonnet chain" docstring at `synthesis_overdrive.py:474` -- only describes MODE=1; reword to "OVERDRIVE_MODE=1 path -- Opus-then-Sonnet chain. MODE>=2 paths supply `chain_override` and reuse this function for the actual per-model dispatch."

**E2 frame** -- bounded sweep; produce the list, apply the obvious edits; no architectural calls.

- [x] [E2] Sweep active docs (`README.md`, `doc/HME.md`, `doc/SRC.md`, `doc/templates/*.md`, `tools/HME/KB/learnings.jsonl` if mode-mentions, `.env` MODE description block) for mode enumerations that stop at 3 or 4; produce a per-file diff list and apply trivial textual fixes (drift only -- not semantic rewrites).
- [x] [E2] In `synthesis_overdrive.py`, locate the legacy "OVERDRIVE_MODE=1 Opus-then-Sonnet" comment/docstring drift at lines 253/438/440/452/457 (per mode4 devlog inventory) -- rewrite each to acknowledge MODE>=2 callers passing `chain_override`. No logic change.

**E4 frame** (sequenced before E3/E5) -- multi-file invariant audit + design-pattern review; produce verdicts before edits; report-then-fix.

- [x] [E4] Cross-file MODE=N gate audit. Inventory every site that reads `OVERDRIVE_MODE` and verify MODE=5 reachability: `hme_proxy.js:486` (must NOT swap; verify falls through), `proxy-supervisor.sh:129`, `proxy-watchdog.sh:40`, `launcher/polychron-launch.sh:75` (the OmniRoute branches), `buddy_dispatch_status.py:227` (display), `verify_coherence/env_settings.py:98` (auth injection check). Produce a per-site verdict (correct / drifted / undefined-behavior) and fix the drifted ones in the same pass.
- [x] [E4] Design-pattern audit: are MODE=2/3/4 degenerate cases of MODE=5 (one-element registry chains)? Compare each mode's chain definition to what a MODE=5 lookup would return if `config/models.json` had matching entries. Include an early-exit audit: any caller that branches on `OVERDRIVE_MODE` before reaching synthesis (so collapsing the elif-arms does not break a non-synthesis path). If collapsible, produce a migration sketch (do not execute -- queue to E5). If not collapsible, document the divergence.

**E3 frame** -- Strategy-pattern refactor; one file in scope; preserve behavior under existing tests (`synthesis_overdrive_mode2/3/4.test.js`). Run AFTER E4 reports.

- [x] [E3] Refactor the MODE=2/3/4/5 elif ladder in `synthesis_reasoning.call` (lines 362-443) into a dispatcher dict `_MODE_DISPATCHERS: {str -> Callable[[tier], Optional[tuple[chain, allow_subagent]]]}`. Each mode contributes one resolver fn (`_resolve_mode2_chain`, `_resolve_mode3_chain`, `_resolve_mode4_chain`, existing `_resolve_mode5_chain`). The dispatcher loop becomes mode-agnostic: lookup → resolve → call `_call_opus_overdrive` → set `_last_source` → return. Resolves the OCP violation: adding MODE=6 will be a one-line registration.
- [x] [E3] In `config/models.json`, decide and document the `manually_toprank.E5 = ["mimo-v2.5-pro-go"]` intent: MiMo (`tier_score=4`) currently leads DeepSeek-Pro (`tier_score=5`). Precedence in `_resolve_mode5_chain` is already deterministic (top-rank first, then tier_score desc within cost class) -- the question is whether the data is correct. Either (a) raise MiMo's `tier_score` to 5 and drop the override (data fix), or (b) keep the override and add a `_meta.toprank_rationale.E5` field explaining why score-inversion is intentional. Avoid having two ranking mechanisms silently fight.

**E5 frame** -- exhaustive cross-cutting consolidation; senior-reasoning eligible; design judgment required. Run AFTER E4 + E3.

- [x] [E5] If E4's audit finds MODE=2/3/4 collapsible into MODE=5's registry-driven shape, execute the consolidation: add the equivalent named-chain entries to `config/models.json` (e.g., a `legacy_chains.mode2 = ["claude-opus-4-7", "claude-sonnet-4-6"]` block), and after the E3 refactor lands, remove the four hardcoded resolver fns in favor of a single registry-driven lookup keyed by mode string. Tests: `synthesis_overdrive_mode{2,3,4}.test.js` must continue to pass unchanged. If E4 found them not-collapsible, this item flips to "document the irreducibility in `doc/HME.md` MODE-evolution section and close."
- [x] [E5] Whole-surface OVERDRIVE_MODE coherence sweep: take the inventory from E4, plus any new sites surfaced by grep `OVERDRIVE_MODE` across `tools/HME/`, `.env`, `config/`, `doc/`, `scripts/`, `runtime/`, and any test that pins a mode value. Produce one unified verdict table (file:line → behavior under each MODE value 0..5 → correctness) and fix every drifted site. Outcome: MODE=5 has zero silent-fallthrough or undocumented-default sites left.

## Deferred to next cycle (ranked surfaces from this round's reviews)

<!-- Empty; populate per-cycle, auto-cleared on archive_now. -->

## Deferred / out of scope

<!-- Empty; populate per-cycle, auto-cleared on archive_now. -->

## Deferred to next cycle (ranked surfaces from this round's reviews)

<!-- Empty; populate per-cycle, auto-cleared on archive_now. -->

## Deferred / out of scope

<!-- Empty; populate per-cycle, auto-cleared on archive_now. -->

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
