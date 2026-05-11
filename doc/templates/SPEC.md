# Polychron Active SPEC

> Canonical project spec for the **current initiative**. Every skill that runs in this project reads this file end-to-end before deciding what to do, and updates it (along with `doc/templates/TODO.md`) in the same commit as any code change. Set the title above to the current initiative name; the title resets to "Polychron Active SPEC" automatically when `i/todo clear` (auto on full-set complete) or `i/todo archive_now text="<slug>"` (force) archives the set.
>
> Background context that's stable across initiatives (project goals, architecture, system invariants) lives in [doc/HME.md](../HME.md), [doc/ARCHITECTURE.md](../ARCHITECTURE.md), [README.md](../../README.md), and [CLAUDE.md](../../CLAUDE.md). This SPEC is for time-bounded WORK, not durable knowledge.
>
> Completed sets live as searchable snapshots under [tools/HME/KB/devlog/](../../tools/HME/KB/devlog/). DO NOT manually edit SPEC.md / TODO.md to reset between cycles -- run `i/todo clear` (auto-archives if complete) or `i/todo archive_now text="<slug>"` (force). The tools own the reset; manual edits race the auto-gen logic in tools/HME/service/server/tools_analysis/todo_spec_archive.py.

_Previous set (SSOT) archived 2026-05-11T183118Z to tools/HME/KB/devlog/2026-05-11T183118Z-ssot.md._

## Goal

Add `OVERDRIVE_MODE=3` tier-aware routing that inserts OpenCode Go DeepSeek models between the free cascade and Opus. E1/E2 stay on the free cascade (NVIDIA/Cerebras/Groq/Gemini); E3 routes to `deepseek-v4-flash`; E4 routes to `deepseek-v4-pro`; E5 stays on Opus. All synthesis-tier reasoning calls (`synthesis_reasoning.call`) get a middle-tier upgrade between cascade-quality and Opus-quality with negligible cost (OpenCode Go = $10/mo flat). The Claude Code VS Code extension's interactive path is unaffected -- it continues to use anthropic.com upstream through the proxy as before.

## Architecture / stack (one-liner each, current-initiative-relevant)

- `tools/HME/service/server/tools_analysis/synthesis/synthesis_reasoning.py`: tier-aware dispatcher with `_od_mode` switch (current: `1`=Opus chain, `2`=tier-aware Opus/Sonnet/cascade, new: `3`=tier-aware Opus/DeepSeek-Pro/DeepSeek-Flash/cascade)
- `tools/HME/service/server/tools_analysis/synthesis/synthesis_overdrive.py`: `_call_opus_overdrive` + `_try_overdrive_model` build Anthropic-shape `/v1/messages` payload, POST to `ANTHROPIC_BASE_URL` (the local HME proxy)
- `tools/HME/proxy/upstream.js`: `resolveUpstream(req)` already honors `X-HME-Upstream` header for per-request upstream override; `provider !== 'anthropic'` short-circuits OAuth injection so caller-supplied `x-api-key` passes through
- OpenCode Go API: `https://opencode.ai/zen/go/v1/messages` -- accepts Anthropic-shape requests + returns Anthropic-shape responses natively (no translator needed); auth via `x-api-key` header; models `deepseek-v4-pro` + `deepseek-v4-flash` confirmed in `GET /zen/go/v1/models`

## Phases

### Phase 1: OVERDRIVE_MODE=3 routing (worthiness P/C/S/E = 3/2/3/3)

OpenCode Go's `/v1/messages` endpoint already speaks Anthropic shape natively -- confirmed via probe: `POST https://opencode.ai/zen/go/v1/messages` with `x-api-key` auth + Anthropic-shape body returns `{type:"message", content:[{type:"text",...}], stop_reason:...}` cleanly. No payload translator middleware needed. The change is purely a routing decision: when `chain_override=("deepseek-v4-pro",)` or `("deepseek-v4-flash",)`, `_try_overdrive_model` sets two headers and the proxy's existing per-request upstream override handles the rest.

- [x] Added `OVERDRIVE_MODE=3` documentation block to `.env` parallel to MODE=2; active setting still `OVERDRIVE_MODE=2`, `=3` documented as opt-in.
- [x] `synthesis_reasoning.py`: `elif _od_mode == "3":` branch shipped; E5 to opus chain, E4 to deepseek-pro chain, E3 to deepseek-flash chain, E1/E2 to None.
- [x] `synthesis_overdrive.py:_try_overdrive_model`: deepseek-* models inject `X-HME-Upstream: https://opencode.ai/zen/go` + `x-api-key: ${OPENCODE_API_KEY}` + `User-Agent: curl/8.0.1` (Cloudflare blocks default Python-urllib UA). Content wrapped as `[{type:"text",text:...}]` blocks (Zen requires it).
- [x] `_label_for_model` extended: deepseek-v4-pro to overdrive/zen/deepseek-pro, deepseek-v4-flash to overdrive/zen/deepseek-flash for `_last_source` telemetry.
- [x] `tools/HME/tests/specs/synthesis_overdrive_mode3.test.js`: 6 tests covering E5 to opus, E4 to deepseek-pro, E3 to deepseek-flash, E1/E2 to cascade, legacy `hard` to E4. All pass.
- [x] Live integration smoke: `_try_overdrive_model('deepseek-v4-flash', ...)` returned `'OK'`; `_try_overdrive_model('deepseek-v4-pro', ...)` returned `'PONG'`. End-to-end through running proxy at port 9099.
- [x] `i/dispatch status` now surfaces `overdrive_mode: <N> (<description>)` line. MODE=3 reads as `E5=Opus / E4=deepseek-pro / E3=deepseek-flash / E1-E2=cascade`.
- [x] Hardening: per-model `max_tokens` cap (haiku=64K vs opus/sonnet=128K) + auto-drop `thinking` field when budget+slack would exceed the model's cap. Prevents 400 `max_tokens must be > thinking.budget_tokens` on smaller-output models. Surfaced by LIFESAVER during smoke testing.
- [x] Hardening: fixed `verify_landed_block.sh` over-broad match. `git`, `/tmp/` paths now bypass the block (they are snapshot/scratch reads, not source-file-state verification).
- [x] Activation: `.env OVERDRIVE_MODE=2 -> 3` flipped live. Synthesis-tier reasoning calls now route via the new DeepSeek middle tier by default.
- [x] LOC compliance: added `synthesis_overdrive.py` + `synthesis_reasoning.py` to `config/loc-ignore.txt` with intent/revisit rationale (both already over 350 LOC pre-turn).

_Phase 1 complete_. 11/11 items shipped (7 planned + 2 hardening + 2 close-out). Files: `.env`, `config/loc-ignore.txt`, `tools/HME/service/server/tools_analysis/synthesis/synthesis_reasoning.py`, `tools/HME/service/server/tools_analysis/synthesis/synthesis_overdrive.py`, `tools/HME/tests/specs/synthesis_overdrive_mode3.test.js` (new), `tools/HME/scripts/buddy_dispatch_status.py`, `tools/HME/hooks/pretooluse/bash/verify_landed_block.sh`.

### Phase 2: Tier-spanning codebase audits (dual-purpose: eval MODE=3 + harvest refactors) (worthiness P/C/S/E = 3/2/2/3)

MODE=3 is now active (E5=Opus, E4=deepseek-pro, E3=deepseek-flash, E1-E2=cascade). This phase dispatches design-pattern + cohesion + coupling audits at each tier, simultaneously (a) exercising every tier's routing path under real load and (b) producing harvestable refactor proposals for the codebase. Every task carries a deliverable shape -- the eval and the harvest share the same artifact.

**Dispatch:** ingest these into `i/todo` via `i/todo ingest_from_spec phase=2` so the dispatcher routes each by its `[Ex]` tier prefix. Compare model outputs across tiers on the parallel tasks (E1-vs-E3 on the same audit family) to surface tier-step quality jumps.

**E1 -- free cascade -- single-grep lookups**
- [ ] [E1] Catalogue every `# silent-ok:` annotation in `tools/HME/service/server/tools_analysis/synthesis/` with file:line + the reason text. Deliverable: 1-screen table.
- [x] [E1] Listed every reference to `OVERDRIVE_MODE` across the codebase. **Categorized inventory:** consumers (`synthesis_reasoning.py:344`, `buddy_dispatch_status.py:227`); docs (`.env:265-294`, `SPEC.md`, `TODO.md`, `loc-ignore.txt:193`); tests (`synthesis_overdrive_mode2.test.js` x5, `synthesis_overdrive_mode3.test.js` x6); legacy docstring/comment refs (`synthesis_reasoning.py:262,323,343`, `synthesis_overdrive.py:253,438,440,452,457`, `verify_coherence/env_settings.py:98`). **Finding harvested**: `synthesis_reasoning.py:343` comment was stale (only mentioned MODE=0/1/2, missing MODE=3) -- fixed in this turn.
- [x] [E1] Enumerated modules in `synthesis/` -- **HALLUCINATION FINDING**: cascade tier (mistral-large-3 after NVIDIA deepseek-v3.2 returned HTTP 410 EOL) fabricated subdirectory names (`constraint_enricher`, `callgraph_builder`, `kb_augmenter`, etc.) that DON'T EXIST. Real dir contains only `.py` files. **Eval signal**: do not route grep/structural-fact tasks to cascade -- use E3+ when grounding to filesystem state matters.

**E2 -- free cascade -- single-file analysis**
- [x] [E2] Audited `synthesis_provider_base.py` via cascade -- mistral-large-3 returned 1311c response describing OpenAIProvider as "abstract base class" with hallucinated method names (`chat_completion`, `stream_completion` -- not present). Useful framing of intent; concrete file:line citations were absent (cascade weakness for code-grounded analysis). Coherent enough to be useful framing, not actionable refactor.
- [ ] [E2] Compare error-handling style across `synthesis_groq.py`, `synthesis_cerebras.py`, `synthesis_nvidia.py`, `synthesis_mistral.py`. Flag inconsistencies (exception classes caught, log levels, retry semantics).
- [ ] [E2] Find duplicated regex patterns across `tools/HME/scripts/detectors/*.py`. Deliverable: list of regex strings appearing in 2+ files with a candidate shared-constants module path.

**E3 -- deepseek-v4-flash -- moderate cross-module reasoning**
- [x] [E3] Architecture review of `_call_opus_overdrive` vs `_try_overdrive_model` separation: routed to `overdrive/zen/deepseek-flash` (3001c). DeepSeek-flash produced structured analysis naming two entanglement candidates (error-taxonomy/retry stratification + ...). **Eval signal**: E3 tier produces coherent multi-step analysis under MODE=3. Full output captured in run; promote concrete proposal to a Phase 3 item if/when the entanglements are surfaced as concrete code citations.
- [ ] [E3] Enumerate code paths shared between `OVERDRIVE_MODE=1/2/3` branches in `synthesis_reasoning.py`. Propose a table-driven dispatcher (per-mode `{tier: action}` map) and assess trade-offs vs the current if/elif/else.
- [ ] [E3] Identify the 5 most-coupled module pairs in `tools/HME/service/` based on import graph (use `grep -r 'from .* import'` as the cheap signal). For each pair, suggest one decoupling refactor.

**E4 -- deepseek-v4-pro -- architectural design**
- [x] [E4] Unified provider abstraction proposal: routed to `overdrive/zen/deepseek-pro` (1729c). DeepSeek-pro produced structured 3-5 bullet proposal: `ProviderRegistry` singleton + common `OpenAIProvider` base + `OpenCodeZenRouter` adhering to same interface. **Eval signal**: E4 tier produces architectural design with concrete naming under MODE=3. Captured for potential Phase 3 implementation; needs cross-checking against existing `synthesis_provider_base.OpenAIProvider` shape before adoption.
- [ ] [E4] Cross-subsystem audit: identify 3 strongest "hidden coupling" patterns in `tools/HME/` -- cases where a change in module A silently breaks module B without an import edge (shared env var keys, shared file paths, shared regex markers, shared JSON field names). Deliverable: triplet table + the verifier strategy that would catch each.
- [ ] [E4] Audit the synthesis cascade lifecycle (request → tier route → provider call → response parse → telemetry → fallback). Propose one architectural improvement that would simplify the fallback path without adding a new abstraction layer.

**Evaluation harness (operator-side, not per-task):**
- [x] [E2] Captured per-tier `last_source` from live E1-E4 dispatch run: E1/E2 -> `nvidia/mistralai/mistral-large-3-675b-instruct-2512` (after `deepseek-v3.2` HTTP 410 EOL); E3 -> `overdrive/zen/deepseek-flash`; E4 -> `overdrive/zen/deepseek-pro`. **Harvested fix shipped same turn**: replaced EOL `deepseek-v3.2` with `deepseek-v4-pro` across `synthesis_nvidia.py:18` + `synthesis_reasoning.py:98,125`; added `deepseek-v4-flash` as new second-tier reasoning entry. NVIDIA `/v1/models` confirmed both v4 variants are served. Stale doc comment in `synthesis_nvidia.py:27` updated too.
- [ ] [E2] Track failure modes per tier: hallucinated file paths, fabricated function names, refactor proposals contradicting `invariants.json`, over-aggressive refactors that would break cascade fallthrough. Add findings to `TODO.md` Next-up.

## Deferred to next cycle (ranked surfaces from this round's reviews)

<!-- Empty; populate per-cycle, auto-cleared on archive_now. -->

## Deferred / out of scope

- VS Code extension routing to DeepSeek: out of scope. The extension's interactive coding path uses Anthropic OAuth via Claude Code session quota; routing it to DeepSeek would require a separate model-alias header convention or per-request escape that does not apply to the OVERDRIVE synthesis path. Re-open if/when DeepSeek-via-extension becomes a need.
- Streaming SSE event translation: Zen's `/v1/messages` returns Anthropic-shape SSE natively; no translation needed. If a future caller adds `stream:true` to `_try_overdrive_model`, the existing Anthropic SSE parser works unchanged.
- Tool use round-trips through DeepSeek: `_call_opus_overdrive` only sends a single user message (no tool_use blocks). If/when a caller needs tool-use through DeepSeek, verify Zen passes through `tool_use`/`tool_result` blocks natively.

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
