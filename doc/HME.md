# Hypermeta Ecstasy

> Master executive for hypermeta evolutionary intelligence. Cognitive substrate for self-evolving composition. Continually evolving to remove the ceiling on coherence through intelligently managed context-efficiency.

## What HME is

13 agent-callable tools (evolve / review / read / learn / trace / status / hme_admin / hme_todo / agent / grep / glob_search / edit / holograph), a self-coherence verifier substrate that scores HCI on 0-100, lifecycle hooks that automate the evolution loop, and a local-LLM subagent pipeline (Explore + Plan modes with a domain-fine-tuned QLoRA arbiter). No layer is optional.

## The Five Layers

| Layer | Location | Role |
|---|---|---|
| MCP / tools surface | `tools/HME/` | The 13 tools above (called via `i/<tool>` shell wrappers) |
| CLAUDE.md | `CLAUDE.md` | Rules, boundaries, mandatory workflow, hard constraints |
| Hooks | `tools/HME/hooks/` + `~/.claude/settings.json` | Automated workflow + evolution-loop driver |
| Lab | `lab/` | Experimental harness for isolated prototyping |
| KB | `tools/HME/KB/` | Lance tables: code chunks, knowledge, symbols |

## Where to find detail

| Topic | File |
|---|---|
| Setup, prerequisites, directory tree, lance tables, Worker HTTP endpoints, Operator commands (`hme_admin(action=...)`: selftest/health/reload/index/clear_index, indexing-mode R97), maintenance | [README.md](../README.md) (Setup) + [HME_TOOLS.md](HME_TOOLS.md) (operator commands) |
| Public tool surface — full mode tables for evolve / review / read / learn / trace / hme_admin, "when to use what" lookup, Knowledge KB categories | [HME_TOOLS.md](HME_TOOLS.md) |
| Hooks integration & Phase 1-6 subsystems (activity bridge, inference proxy, pipeline policy gate, KB staleness, coherence score, blind-spots, cascade, jurisdiction injection, hypotheses, drift, prediction accuracy, crystallization, music truth, trust-weighted KB, intention gap, self-audit, adversarial probes, trajectory, coherence budget, negative space, cognitive load, reflexivity, constitutional identity, doc drift, generalizations, multi-agent scaffold, human ground truth, hook scripts) | [HME_SUBSYSTEMS.md](HME_SUBSYSTEMS.md) |
| Polychron-specific RAG/synthesis stack (IIFE chunking, embedding model, symbol indexing, two-local arbiter fleet, warm KV contexts, five-stage synthesis pipeline, think-session memory, unified narrative, context-budget awareness, temporal decay, knowledge relationships) | [HME_RAG_STACK.md](HME_RAG_STACK.md) |
| Evolution loop integration, mandatory per-session workflow, lab governance, autonomous ralph-loop | [HME_EVOLUTION_LOOP.md](HME_EVOLUTION_LOOP.md) |
| Testing & chaos battery (smoke tests + chaos injectors) | [HME_TESTING.md](HME_TESTING.md) |
| Self-coherence verifier substrate, HCI engine, LIFESAVER no-dilution rule, detector calibration, session evolutions log, Phase 7 four-arc framework | [HME_SELF_COHERENCE.md](HME_SELF_COHERENCE.md) |
| Onboarding state machine + per-session walkthrough | [ONBOARDING.md](templates/ONBOARDING.md) |
| Architectural trajectory each `i/state` / `i/why` / `i/timeline` tool advances |
| Mental model for HME's role in evolution | [HME_MENTAL_MODEL.md](HME_MENTAL_MODEL.md) |
| State ownership rules (single-writer registry, etc.) | [HME_STATE_OWNERSHIP.md](HME_STATE_OWNERSHIP.md) |
| LIFESAVER alert pipeline | [LIFESAVER.md](LIFESAVER.md) |
| Local LLM stack (arbiter, embedders, daemon) | [LOCAL_LLMS.md](LOCAL_LLMS.md) |
| Pure HME thesis (the why) | [HYPERMETA.md](HYPERMETA.md) |
| Crystallized discoveries promoted from KB | [hme-discoveries.md](hme-discoveries.md) |

## Tool invocation

`i/<tool>` shell wrappers in project root POST to the worker's HTTP endpoint (default port 9098):
```
i/learn   query="coupling"          i/trace  target=<module> mode=impact
i/review  mode=forget               i/evolve focus=<axis>
i/state                             i/timeline window=30m
i/why     mode=<...>                i/help
```
The `i/state` + `i/why` + `i/timeline` triad covers "what state am I in / why did this fire / what just happened".

## Core workflow

1. **Edit** — `pretooluse_edit.sh` auto-surfaces KB constraints; no manual `read()` needed.
2. **After change** — `i/review mode=forget` (auto-detects changed files from git).
3. **After confirmed round** — `i/learn title=... content=... category=pattern` for calibration anchors.
4. **When lost** — `i/state` (snapshot) → `i/why` (causality) → `i/timeline` (chronology).

## Stop-hook behavioral detectors

Every `Stop` event runs [run_all.py](../tools/HME/scripts/detectors/run_all.py); each detector prints one verdict line that [stop chain](../tools/HME/proxy/stop_chain/policies/) routes to a deny prompt. Per-fire telemetry at `output/metrics/detector-stats.jsonl`; query via `scripts/analyze-detector-stats.py`.

| Detector | Catches |
|---|---|
| `poll_count` | 2+ background-task polls in one turn |
| `idle_after_bg` | Background pipeline launched then stopped |
| `psycho_stop` | Survey-and-ask / admit-and-stop / launch-and-wait |
| `ack_skip` | CRITICAL surfaced + no follow-up Edit |
| `abandon_check` | Subagent for KB work instead of HME tools |
| `stop_work` | Dismissive or short-text-only final |
| `fabrication_check` | Quantitative invariant claim without verification |
| `early_stop` | Open-ended directive + enumerated gaps + no tools |
| `exhaust_check` | Deferral phrase + bullet list (unconditional) |
| `scope_escape` | Pre-existing/unrelated label-and-stop |
| `senior_consult_debt` | Buddy-paradigm edits without `i/consult` |
| `trample_gate` (proxy middleware) | Mid-response user message ignored (request-time, not Stop-time) |
| `phantom_capability` | Declared capability outside the closed enum |
| `advisor_doctrine` | E2+ commit boundary without consult / solo rationale |
| `summary_format` | E5 work without `SUMMARY` block |
| `ceremony_dodge` | Text-only rescue-pattern response to a deny |
| `live_probe` | ISA edit leaving `[x]` ISCs without Verification |
| `phase_gate` | E5 open-ended edit without BUILD/EXECUTE marker |

## Hooks integration

Phase 1-6 add 30 observability/governance subsystems built on the activity-bridge JSONL stream (`output/metrics/hme-activity.jsonl`). All emit through `tools/HME/activity/emit.py`. Surfacing via `status(mode=<subsystem>)`. Phase 7 (Four-Arc Framework) overlays consensus / pattern-registry / inverse-reasoning / meta-measurement on top.

For per-subsystem detail, query the relevant `status(mode=...)` or grep this codebase for the subsystem name (each phase's narrative is preserved in commit history and KB devlog entries).

## ISA + verification doctrine

PAI-imported: every E2+ task has an Ideal State Artifact (`ISA.md`, 12 sections) with binary tool-probe ISCs. ID-stability rule (no renumbering on edit), `[DEFERRED-VERIFY:<task>]` escape clause, CheckpointPerISC auto-commit on `[ ]→[x]` transitions. Audit via `tools/HME/scripts/isa/audit-isa.py`. Template at [tools/HME/skills/ISA/TEMPLATE.md](../tools/HME/skills/ISA/TEMPLATE.md).

## Project-wide audits

`bash scripts/audit-all.sh --strict` runs:
- `audit-loc` (LOC ≤350 / file)
- `audit-python-undefined` (F821-class)
- `audit-no-non-ascii` (strict ASCII, no allowlist)
- `audit-shell-undefined` (shell `set -u`)
- `audit-import-boundaries` (subsystem public surface)
- `audit-hook-coordination` (MUST RUN BEFORE/AFTER docstring graph)
- `audit-doc-integrity` (markdown cross-refs resolve)
- `test-deny-alternatives` + `test-detector-chain` + `audit-detectors-corpus`
- `audit-isa` (when any `tmp/isa/*/ISA.md` exists)

## Setup

Source tracked in `tools/HME/`. KB at `tools/HME/KB/`. Worker (`tools/HME/service/worker.py`) spawns under proxy (`tools/HME/proxy/hme_proxy.js`). Skills at `skills/`, symlinked from `~/.claude/skills/`. First use: `/HME` to load skill.

## Maintenance

- Reindex: file watcher auto-fires (5s debounce, 5min cooldown); batch via `i/hme-admin action=index`.
- KB: `i/learn action=health` (stale refs), `action=compact` (dedup at 30+ entries), `action=export` (markdown dump), `action=dream` (hidden-connection mining).
- Doc sync: `i/review mode=docs` verifies docs match implementation.
- Self-maintenance when tools feel wrong: selftest → health → compact → docs → reload.
