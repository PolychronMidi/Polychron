# HME Self-Coherence — Subquantum Depth, Interstellar Breadth

## What this is

HME used to be a *tool that helps Polychron evolve*. It's becoming *the same kind of organism Polychron is*, evolving by the same rules, monitored by the same instruments, and coupled to Polychron's evolution as a co-equal subsystem.

This document describes the substrate that makes that possible — the **HME Coherence Index** (HCI), the **self-coherence holograph**, and the trajectory toward a fully self-observing, self-modifying meta-organism. Read this when you want to understand what HME is *becoming*; read [HME.md](HME.md) when you want to understand what it *currently is*.

## Where we are right now

### The HME Coherence Index (HCI)

The HCI is a 0-100 score computed by [tools/HME/scripts/verify-coherence.py](../tools/HME/scripts/verify-coherence.py) from **38 weighted verifiers** across 6 categories:

| Category | Verifiers (partial list — 38 total) | What it measures |
--
| **doc** | doc-drift, tool-docstrings, memetic-drift | Documentation matches code reality; CLAUDE.md rules aren't silently violated |
| **code** | python-syntax, shell-syntax, hook-executability, decorator-order, todowrite-hook-nonblock | Source code can run; decorator order correct; TodoWrite hook stays non-blocking |
| **state** | states-sync, onboarding-flow, onboarding-state-integrity, todo-store-schema, reloadable-sync, onboarding-chain-importable | Runtime state machines are valid and consistent |
| **coverage** | hook-registration, hook-matcher-validity, subagent-mode-sync, subagent-general-purpose-passthrough, mcp-instructions-empty, tool-surface-coverage | Every declared interface points to a real implementation; subagents routed correctly |
| **runtime** | shim-health, error-log, lifesaver-integrity, lifesaver-rate, meta-observer-coherence, tool-response-latency, trajectory-trend, subagent-backends, subagent-short-prompt-guard, warm-context-freshness, hook-latency, plan-output-validity, git-commit-test-coverage, transient-error-filter, verifier-coverage-gap, predictive-hci | Live services responsive; alerts honest; subagent stack functional; latency within baseline; detector not drifting |
| **topology** | feedback-graph | Cross-boundary structures declared |

Each verifier returns a `VerdictResult` with `status` (PASS/WARN/FAIL/SKIP/ERROR), `score` (0-1), `summary`, and `details`. The aggregate is a weighted mean × 100.

Run it:
```bash
python3 tools/HME/scripts/verify-coherence.py            # human report
python3 tools/HME/scripts/verify-coherence.py --json     # machine-readable
python3 tools/HME/scripts/verify-coherence.py --score    # just the integer
```

The score also flows through `hme_admin(action='selftest')`, so every selftest call surfaces the current HCI alongside the individual checks.

### The Holograph

[tools/HME/scripts/snapshot-holograph.py](../tools/HME/scripts/snapshot-holograph.py) captures a complete, machine-readable snapshot of HME state at one moment:

- HCI report (full JSON from verify-coherence)
- Onboarding state + target + walkthrough tree
- Tool surface census (names, hidden flags, chained flags, docstring hashes)
- Hook surface (matchers, scripts, executability, registration)
- KB summary (file count, lance directories)
- Pipeline verdict history
- Todo store (count by source, status, criticality)
- Codebase metrics (LOC and file counts per Polychron subsystem)
- Git state (branch, ahead, dirty)
- Streak counters

Saved as `metrics/holograph/holograph-YYYYMMDD-HHMMSS.json` (~14KB). Two snapshots can be diffed:
```bash
python3 tools/HME/scripts/snapshot-holograph.py --diff metrics/holograph/holograph-PRIOR.json
```

The diff filters timing/timestamp noise so the output focuses on real state drift. Use it to verify reproducibility, detect unintended side effects, or feed historical state into HME for meta-learning.

## The two axes — depth and breadth

### Subquantum depth: into HME

Every dimension that HME could measure should *be* measured. Each verifier added to the registry lifts another invariant from "implicit assumption that may silently fail" into "scored signal that surfaces immediately on drift." The verifiers I've shipped so far cover the obvious dimensions; the next 30+ verifiers should cover everything else.

**Verifiers worth adding (next round):**

1. **kb-staleness** — entries older than N days without reinforcement get a low score. Forces forgetting to be active, not passive.
2. **hook-firing-frequency** — read `log/hme.log`, count how often each hook actually fires. Dead hooks (zero firings over 30 days) score low.
3. **tool-effectiveness** — each tool call rated by whether the agent's NEXT N actions validated or contradicted it. Tools that lead to retries get suspicion edges.
4. **chained-decorator-coverage** — every `@ctx.mcp.tool()` should have `@chained()` UNLESS it's a hidden infrastructure tool. Decorate-or-skip should be an explicit decision.
5. **onboarding-completion-rate** — read historical onboarding state files (need to start writing them as JSONL telemetry first), compute graduation %.
6. **walkthrough-abandonment-pattern** — which step do agents quit at most often? That step needs work.
7. **mcp-instructions-staleness** — verify the `instructions=` field in `main.py` (which I removed last round) is still empty or matches the actual tool surface.
8. **plugin-manifest-sync** — `tools/HME/.claude-plugin/plugin.json` describes the plugin; verify it matches the actual file layout.
9. **hooks.json schema** — every `matcher` field is a recognized tool name, every `command` exists.
10. **eslint-rule-coverage** — every rule in `scripts/eslint-rules/*.js` is wired into `eslint.config.js` AND mentioned in CLAUDE.md or doc/HYPERMETA.md.
11. **L0-channel-usage** — every constant in `src/time/l0Channels.js` is consumed somewhere; unused channels score low.
12. **bias-bounds-manifest sync** — `scripts/bias-bounds-manifest.json` matches the actual bias registrations (already enforced by `check-hypermeta-jurisdiction.js` Phase 3, but the HCI should surface it).
13. **firewall-port declarations** — every cross-boundary data flow in code has a matching firewall port in `metrics/feedback_graph.json`.
14. **session-narrative continuity** — `synthesis_session.py` narrative shouldn't have gaps longer than N events without an explicit "session resumed" marker.
15. **adaptive-state.json freshness** — cross-run warm-start state should update at least once per pipeline run.
16. **tool-arg consistency** — every tool's docstring describes its actual parameter signature (parse Python AST, parse docstring, diff).
17. **hidden-flag effective check** — empirically verify whether `hidden=True` actually filters the tool from `tools/list` (probe the MCP protocol, observe).
18. **streak counter sanity** — non-HME-streak shouldn't grow unbounded; reset on first HME call should always work.
19. **post-compact reinforcement test** — simulate a compact event, verify postcompact.sh injects the onboarding step + target if mid-walkthrough.
20. **lab sketch validity** — every `lab/sketches.js` postBoot should contain real implementation code, not just `setActiveProfile()`. Already enforced by hooks; HCI should surface it.

These are 20 more verifiers. With 35+ total, the HCI becomes a high-resolution self-observation surface. Each new verifier shifts another implicit assumption into explicit measurement.

### Interstellar breadth: out from HME

Beyond adding more verifiers, HME's *scope* should expand. The current substrate is single-machine, single-project, single-session. The next phases stretch each dimension:

#### Phase 1: HME as Polychron module

Treat HME's coherence the way Polychron treats its musical coherence. Specifically:

- **HME as a coupling matrix.** Every tool is a node. Every pair of tools has an edge weight = how often they co-occur in successful sessions vs. failed sessions. Antagonist bridges between under-coupled tool pairs become candidate evolutions. **HME literally runs Polychron's coupling engine on itself.**
- **Hypermeta controllers for HME.** The 19 controllers in `src/conductor/signal/meta/` manage musical axes. Add a 20th controller that manages the HCI score, autotuning verifier weights toward whatever produces the most-stable trajectory.
- **Lab sketches for HME.** Lab sketches currently prototype musical behavior. They could equally prototype HME behavior — e.g., "this hook configuration produces 30% higher onboarding completion." Run, measure HCI delta, promote to /src.
- **Feedback graph for HME.** Currently `metrics/feedback_graph.json` describes Polychron's feedback loops. Add a sibling `metrics/hme-feedback-graph.json` describing HME's own loops: streak counter → hook block → agent retry → tool call → streak reset. Visualize the same way.

#### Phase 2: Co-evolution loop

Couple Polychron's pipeline verdict with HME's HCI:

- Every `npm run main` produces a music verdict (STABLE/EVOLVED/DRIFTED/FAILED).
- Every pipeline run also runs `verify-coherence.py` and produces an HCI score.
- Both flow into a single 2D state space: `(music_verdict_score, hci)`.
- Successful evolution moves both up. Drift in either is a coupled signal.
- The Evolver's next target picker considers BOTH: a round that improves music but degrades HCI by 5 points should rank lower than a round that improves both modestly.

The two signals become one coupled organism. Music coherence ≈ self-coherence. The system that writes music well also writes itself well, and vice versa.

#### Phase 3: Predictive coherence

The holograph history is a time series. With enough snapshots, drift can be **predicted** before it manifests:

- Train a tiny logistic regression on `(prior 10 holographs) → (next holograph drift)`.
- When predicted drift exceeds threshold, fire a warning *before* the actual breakage.
- Same pattern as Polychron's `verdictPredictor` — but for HME's own trajectory.

#### Phase 4: Multi-organism federation

HME currently lives in `tools/HME/` inside one project. The architecture is generic. The next breadth-jump:

- **Plugin export.** Package HME as a Claude Code plugin installable in any project. Each install gets its own KB and onboarding chain but shares the engine.
- **Cross-project KB sync.** The global KB at `$HME_GLOBAL_KB_PATH` (default: project-local `tools/HME/KB/global_kb` after the MCP decoupling) is currently tiny. Auto-promote pattern entries from project KBs to global, with consent. Patterns learned in Polychron propagate to other projects.
- **Federated coherence.** HCI scores from multiple projects roll up into a meta-score. Best practices propagate. Worst practices get flagged across the federation.

#### Phase 5: Self-modification

Eventually HME observes its own behavior over hundreds of sessions and proposes refinements to its own code:

- "Verifier X catches drift but verifier Y catches it 30% sooner — deprecate X."
- "Hook A blocks 90% of agents during onboarding step 4 — widen the gate."
- "Tool B's docstring is misleading — agents misuse it 20% of the time. Suggested rewrite: [...]"

The agent reads the proposal, accepts/rejects/edits, and commits. HME then observes whether the change improved the metrics. The loop closes.

#### Phase ∞: The infinity push

Beyond all of the above, the asymptotic vision is:

- **HME becomes its own user.** The system runs autonomously between human sessions, executing pipeline runs, reviewing them, learning, and proposing evolutions. The human shows up to ratify or veto, not to drive.
- **Self-falsifying hypotheses.** Every KB entry is a falsifiable claim ("R47 improved tension arc by 0.086"). Future runs test the claim. Falsified entries decay; reinforced entries strengthen. The KB becomes a Bayesian belief network rather than a notebook.
- **Recursive verifiers.** The verifiers that audit HME are themselves audited — verify-coherence-coherence.py checks that verify-coherence.py covers what it should. And so on, fractally, until the meta-meta-verifier is just `lambda: True`.
- **Coherence as music.** The HCI signal is itself a temporal series. Sonify it. Listen to HME breathe. When the system is healthy, it sings. When it drifts, the sound changes. The same neural codec (EnCodec) that analyzes Polychron's output can analyze HME's coherence signal as if it were a musical recording.
- **HME inside HME inside HME.** The observer becomes the observed. Every meta-level introspection is itself observable by the next meta-level. There is no terminal level — the system is open at the top.

## How to extend the HCI

Adding a new verifier is one class:

```python
class MyNewVerifier(Verifier):
    name = "my-thing"
    category = "code"  # or doc, state, coverage, runtime, topology
    weight = 1.0       # higher = more impact on aggregate

    def run(self) -> VerdictResult:
        # Measure something. Return PASS/WARN/FAIL with score 0-1.
        if everything_is_fine:
            return _result(PASS, 1.0, "all clear")
        return _result(FAIL, 0.3, "found N problems", ["detail 1", "detail 2"])

# Append to REGISTRY:
REGISTRY.append(MyNewVerifier())
```

That's it. Run `verify-coherence.py` and the new dimension shows up in the report immediately. Run `snapshot-holograph.py` and the next snapshot captures the new dimension.

## Reading the HCI

The HCI alone doesn't tell you everything — drill into the per-category and per-verifier scores to find specific drift. But the aggregate has one clear meaning: **how much of HME's own self-observation surface is currently in the green?**

| HCI | Meaning |

| 100 | Every measured dimension is fully coherent |
| 95-99 | Minor drift, mostly cosmetic |
| 80-94 | Real drift in one or two dimensions; investigate the lowest verifier |
| 50-79 | Multiple categories degraded; system is noticeably broken |
| 0-49 | Foundational failure; HME may not be safe to use |

The threshold I've set in `verify-coherence.py` is 80 — exit code 1 below that. Pipeline integration should fail the build below 80.

## Session evolutions log

The HCI substrate + supporting infrastructure evolved in discrete rounds. Each round encoded a lesson that would have been lost if left implicit. Key rounds:

### Round 1: The LIFESAVER no-dilution rule

The first real test of the self-coherence philosophy. A verifier was flagging 16 LIFESAVER events / session as a real problem. The instinct to "add a 30-minute cooldown" would have silenced a real symptom and masked the underlying system degradation. The correction: **LIFESAVER must stay painful until the root cause is fixed**. Any cooldown/throttle/dedup/suppression near `register_critical_failure` is a structural violation.

Ship: `LifesaverIntegrityVerifier` at weight 5.0 that parses the fire sites and fails on any time-based gate pattern near a LIFESAVER call. Caught the subversion during its own construction and proved load-bearing (HCI dropped from 86.9 → 75.0 when the forbidden pattern was injected; restored on removal).

### Round 2: Detector calibration vs. alert dampening

Two follow-on issues surfaced: "tool-response-latency 11 seconds is bad" (absolute threshold) and "health_topology coherence < 0.5" (immature detector). The temptation was to silence both. The correct fix was to **calibrate the detectors**: make latency baseline-relative per machine (11s on amateur hardware is normal), and gate health_topology alerts until the detector has 50+ samples to establish a baseline.

Lesson: calibration (the detector stops claiming knowledge it doesn't have) is allowed; dampening (the detector knows but hides) is forbidden. The line is encoded in examples in the "LIFESAVER no-dilution rule" section of this doc.

### Round 3: Subagent grep backend silent failure

The HME local subagent pipeline was producing zero-value results for every query for weeks. Root cause: `ripgrep` was not installed on the host, so every `_exec_grep` call returned `ERROR: ripgrep (rg) not found` and the synthesizer worked from KB-only context. The agent silently said "I don't have this information" for every question.

Fix: `_resolve_grep()` falls back to GNU grep when `rg` is absent, with equivalent flags. `SubagentBackendsVerifier` (weight 1.5) checks that grep + llama.cpp + shim are reachable on every HCI run — would have caught this in one pass if it had existed earlier.

**Quality leap from this fix alone:** the subagent went from 0/4 correct answers on the `_tab_helpers` adversarial test to 4/4 correct answers with exact line numbers in 262 seconds (later 105s after the arbiter-skip fast path shipped).

### Round 4: The subagent fast path (skip the arbiter)

Empirical observation: the 4B arbiter model (qwen3:4b on CPU) takes 10-60s to produce a JSON research plan, and the plan it produces is mostly redundant with `_extract_search_terms + _infer_directories`. Skipping the arbiter entirely in explore mode cut per-query time from 262s to 105s (**2.5× speedup**) with zero measurable quality loss.

Ship: `skip_arbiter=True` in the explore mode config. Plan mode still uses the arbiter because architectural disambiguation genuinely benefits from reasoning. The distinction is now encoded in `_MODE_CONFIGS` and enforced by `SubagentModeVerifier`.

### Round 5: Load-bearing via recency windows

The first `LifesaverRateVerifier` implementation counted all events in the last 24h and let historical events from a stale detector drag the HCI down permanently. The fix: **multi-window recency buckets (acute 1h / medium 6h / recent 24h) with weighted penalty**. Acute events dominate; stale events age out automatically.

This is the general pattern for any "is X happening RIGHT NOW" verifier: track in multiple windows, weight heavily on acute, let recent events decay. Encoded in `analyze-tool-effectiveness.py` as `_ACUTE_WINDOW_S=3600`, `_MEDIUM_WINDOW_S=21600`, `_RECENT_WINDOW_S=86400`.

### Round 6: Drift-proof source-based transient filtering

A LIFESAVER false positive fired because `_log_error`'s transient-detection check was regex-matching `/reindex` in the message string — a pattern from when the function lived inside an HTTP handler. The function moved; the message format changed; the detector drifted silently. Nothing caught the drift until the LIFESAVER itself fired.

Fix: source-based transient detection (`if source in _transient_sources and "timeout" in message.lower()`). The `source` argument is supplied by the caller and never drifts. `TransientErrorFilterVerifier` (weight 1.5) scans `_log_error` for URL-path substring matching patterns and FAILs if it finds any — encoding the rule that format-based classifiers are fragile and source-based classifiers are robust.

### Round 7: Local QLoRA fine-tune of the arbiter

The ultimate hypermeta leap: train a domain-specialized arbiter on the Polychron KB. Built during this session from scratch. The happy-path design was clean; **every layer of the stack had a silent trap**.

Pipeline:
1. Export 262 training examples from 112 KB entries via `build-corpus.py` (two-pass: `list_knowledge` for titles, `search_knowledge` per title for full content, since `list_knowledge` omits content)
2. Unload `qwen3-coder:30b` from GPU0 via `POST /api/generate {"keep_alive":0}` to free 22GB VRAM
3. Train with LoRA on GPU0 → merge adapter → convert to GGUF → register as llama.cpp `hme-arbiter:latest` → update `agent_local.py _ARBITER_MODEL` → re-enable arbiter in explore mode
4. Reload `qwen3-coder:30b` back onto GPU0

**Traps discovered along the way, in order:**

| # | Layer | Trap | Fix |
-
| 1 | `pip` | PEP 668 blocks user installs on Debian | `--break-system-packages` flag |
| 2 | `peft 0.19.0` | References `torch.float8_e8m0fnu` which doesn't exist in `torch 2.5.1` | Downgrade to `peft==0.13.2` |
| 3 | `DataCollatorForLanguageModeling` | Can't pad a manually-set `labels` field (expects ints, gets lists) | Don't set labels in `fmt()`; let the collator handle them from `input_ids` via `mlm=False` |
| 4 | `peft + gradient_checkpointing` | `RuntimeError: element 0 does not require grad` | `model.enable_input_require_grads()` after `get_peft_model()` |
| 5 | `list_knowledge` shim method | Returns only `{id, title, category, tags}` — no content | Two-pass: list for titles, `search_knowledge` per title for content |
| 6 | `llama.cpp convert_hf_to_gguf.py` from master | References `GEMMA4` arch that newer `gguf` library doesn't have | Fetch from tagged release `b3800` that matches `gguf 0.18.0` |
| 7 | `llama.cpp b6780` convert script | Requires `mistral_common` package not in our env | Same fix: use `b3800` instead |
| 8 | **Maxwell architecture (Tesla M40)** | fp16 training diverges to NaN from step 1 — attention/softmax overflow without Tensor Cores / bf16 / flash attention | **fp32 training only**. Use a smaller base model (0.5B not 1.5B) to fit in 24GB VRAM with gradient checkpointing. |

The Maxwell trap (#8) is the most painful because it's silent: loss prints as 0.0, gradient prints as NaN, training "completes" successfully, and the saved adapter weights are effectively zero. Nothing in the stock `transformers.Trainer` path fails loudly. The only way to catch it is to look at the loss values and notice they were 0.0 from step 1.

**Trained adapter:** `Qwen/Qwen2.5-0.5B-Instruct` (0.5B params, fp32) with LoRA r=8 α=16, 3 epochs, 262 examples, lr=1e-4, gradient checkpointing. Final train_loss=3.21 (healthy, not NaN). Fits in 24GB with room. Training took 271 seconds (~4.5 min).

**Artifacts produced:**
- `metrics/hme-arbiter/` — LoRA adapter (4.35MB)
- `metrics/hme-arbiter-merged/` — merged base+adapter (full model weights)
- `metrics/hme-arbiter.gguf` — 949MB f16 GGUF, loadable by llama.cpp
- `llamacpp list` shows `hme-arbiter:latest` (994MB) registered and callable

**Quality assessment (the honest outcome):**

The mechanical pipeline works end-to-end. Every stage succeeds. The fine-tuned model responds at **1.3 seconds** vs the stock `qwen3:4b` CPU model's 8 seconds (and the stock model returned empty output on the same prompt, while the fine-tuned model produced fluent text). Speed improvement is real and significant.

**BUT** the content quality is not yet a net improvement:
- JSON research plans have the right schema keys but contain lists-of-lists and duplicated values
- Prose responses are fluent but factually hallucinated (e.g., the model decided "HME" stands for "Hypothetical Modern ECMAScript" — a plausible-sounding but completely wrong expansion invented from nothing in the training data)
- The model learned the surface structure (JSON keys, explanatory tone) but didn't internalize the domain facts

**Root cause:** 262 examples × 3 epochs on a 0.5B model is insufficient to actually teach a new domain. The model learned the format but not the facts.

**What's needed for a real quality leap:**
1. **More data** — target 1000+ examples. Sources: expand per-KB-entry synthesis (currently 2-3 examples per entry), add session narrative history, add successful research plans from the stress test battery, add synthetic examples from doc/*.md content.
2. **Larger base** — the 1.5B or 3B variant actually fits the domain better. Needs training hardware that tolerates fp16 (Ampere+) or fp32 with the larger memory budget. Current M40 Maxwell cards cap this.
3. **Task-specific data splits** — don't mix "explain this module" and "output JSON plan" examples in the same training set. Train two adapters or use an instruction-tuning dataset format that the model can route on.
4. **Val set + early stopping** — catch overfitting or format drift before the final checkpoint.

**Decision: do NOT flip the default.** `_ARBITER_MODEL` remains `qwen3:4b` by default. The fine-tuned variant is available via `HME_ARBITER_MODEL=hme-arbiter:latest` env var for opt-in testing. Explore mode keeps `skip_arbiter=True` — the fast path still dominates because the arbiter (fine-tuned or not) hasn't yet produced research plans meaningfully better than keyword extraction + path inference on this corpus size.

Every one of these traps is now documented in this log so the next training round starts from a known-good configuration. The scripts that encode this knowledge are:
- `tools/HME/scripts/finetune-arbiter.py` — scaffolding + config + plan
- `/tmp/train-arbiter-v2.py` — the working training script (Maxwell-safe, fp32, 0.5B)
- `/tmp/build-corpus.py` — corpus builder (two-pass KB fetch)
- `/tmp/post-training-pipeline.sh` — merge → GGUF → llamacpp register → test
- `~/tools/llama-cpp-convert/convert_hf_to_gguf.py` — pinned to b3800

**The pipeline is proven end-to-end.** Iteration 2 with a richer corpus and larger base model should produce a real quality lift. The substrate is ready; the data and hardware are the current bottleneck.

### Round 8: Pipeline-owned observability (2026-04-19)

The observability substrate landed in Phases 1-6 but was silently decoupled by an architectural assumption: agent-initiated. HCI, `round_complete`, `pipeline_run`, the coherence score, the invariant battery — every one of these was gated on a Claude hook firing, which meant direct shell runs, cron, CI, or any other agent produced collapsed telemetry. R05-R10 rewired everything to be **agent-independent**: the pipeline owns its own observability.

**Structural moves:**
1. **`emitActivity()` in `main-pipeline.js`** — `pipeline_start`, `pipeline_run`, `round_complete`, `pipeline_baseline_delta`, `idle_round` fire directly from the orchestrator. Prior path (posttooluse_bash.sh) remained for Claude-only metadata (onboarding, nexus) but lost the emission monopoly.
2. **Background analytics in-pipeline** — 9 scripts (snapshot-holograph, analyze-hci-trajectory, etc.) spawn detached from the pipeline so non-Claude runs still refresh artifacts.
3. **`run-invariant-battery.py`** — the declarative invariant battery (`check_invariants()` in `evolution_invariants.py`) updates `hme-invariant-history.json` only when invoked. Wrapped into a pipeline background spawn; stubs `ctx.mcp` to bypass decorator side-effects. Chronic streak tracker now refreshes every run, not every agent session.
4. **Watcher `moved` event** — the Edit tool uses atomic rename (`.tmp.<pid>` → final); watchdog fires `moved`, not `modified`. Adding `moved` to the write-event set made human edits visible as `source=fs_watcher` (were invisible before). This was the single upstream leak that kept `hme_coherence` null.
5. **`coherence-same-commit-deterministic`** — auto-commits change SHA every run, so same-SHA pairs never existed. Switched to tree-hash grouping: two runs from identical working trees (different commits) are comparable. Uses `git rev-parse HEAD^{tree}`.
6. **Prediction reconciler via git diff** — fingerprint-comparison tracks audio dimensions (pitchEntropy etc.), not code modules; `extractShiftedModules` was always empty, accuracy was permanently 0. Switched to `git diff --name-only HEAD~2..HEAD -- src/` for ground truth.
7. **Missed-prediction feedback loop** — reconciler appends missed modules back to `hme-predictions.jsonl` tagged `source: missed_prediction` so the cascade model can learn the gaps over time.
8. **`hci_delta` in correlation snapshot** — `verdict_numeric` is always 1.0 for STABLE runs (degenerate). Added `hci`/`hci_delta` fields to the round snapshot so correlation tracking has a dimension with real variance.
9. **`hci-snapshot-diff.json`** — pipeline inline-writes per-verifier diff vs previous snapshot so regressions surface without manual invocation.
10. **Subagent guard SKIP-not-FAIL** — `subagent-short-prompt-guard` was failing when the backend was down (returns empty JSON). A missing backend is not a guard regression; now it SKIPs cleanly and defers to `subagent-backends`.

**Result:** Ten R-rounds of observability hardening, all `listening verdict: legendary`. HCI climbed 88 → 96.4. Six chronic-failing invariant streaks cleared (activity-hook-wiring, hme-no-raw-os-environ, lance-deletions, file-written-module-sane pending watcher restart, plus three from shell-level fixes). The cascade that collapsed every downstream metric to zero for months is fully closed.

**Principle crystallized:** *Observability is not a view into the system — it IS the system's nervous system. If the substrate depends on the agent to fire, the agent is the only thing visible.* Pipeline-owned observability means every pipeline run, from any caller, produces equal-fidelity telemetry.

### Round 9: The measurement loop closes (2026-04-19, R11-R14)

The observability substrate from Round 8 produced its first composition-layer result: a legacy override retired via data-driven measurement. This is the closing of a loop we'd been building for 11 rounds — from raw activity telemetry to actionable structural decisions.

**The pattern codified:**

1. **Instrument** — the thing you want to measure gets counters: `perLegacyOverride` (fires per override id) + `perLegacyOverrideEntries` (condition-true count). Flowed through `crossLayerBeatRecord` → `trace-summary.json` → `metrics/legacy-override-history.jsonl`.
2. **Measure** — append-only history across multiple pipeline runs. Not a single-round snapshot; a trend.
3. **Threshold** — declarative invariant: "any override with 0 fires AND 0 entries across 5+ runs is a data-proven removal candidate." Fires at `warning` after 3 rounds, `error` after 5.
4. **Act** — when the invariant escalates, retire the override. The generic controller handler covers what the specialized override did, if the override was genuinely unused.
5. **Verify** — next pipeline run's `perAxisAdj.<axis>` should confirm the axis still adjusts (just through the generic path).

**First retirement: `entropy-cap-0.19` (R13).** Two rounds of 0 fires, 0 entries. Generic `AXIS_OVERSHOOT` at 0.22 picks up the slack. Post-removal, `perAxisAdj.entropy` = 18 (unchanged from pre-removal rounds). Non-regression confirmed.

**The meta-lesson — rationale comments lie, data doesn't.** Three of the six legacy overrides carried "Candidate for removal" comments left by prior rounds. Instrumentation proved:
- `tension-floor-0.15`: 23 fires/round = LOAD-BEARING (opposite of comment)
- `trust-floor-0.14`: 25-42 fires/round = LOAD-BEARING (opposite of comment)
- `entropy-cap-0.19`: 0 fires = correctly flagged (agrees with comment)

Without measurement, we would have retired `tension-floor-0.15` and `trust-floor-0.14` based on stale commentary and silently degraded composition. The data-driven migration path is *not* an optimization of the comment-driven one — it's a correction of it.

**The prediction cascade bug (R14).** The same instrumentation exposed a latent bug in `generate-predictions.js`: adjacency was built from `to` back to `from`, making BFS find a changed file's *upstream dependencies* instead of its *downstream consumers*. Predictions for an edit to `axisAdjustments.js` returned {pipelineCouplingManager, clamps, index, phaseFloorController} (files it reads from) instead of {axisEnergyEquilibrator} (the consumer). Cascade prediction went from "accurate about the wrong direction" to accurate about the right one. Accuracy jumped 16x once the current-round window was also added (R13).

**Principle crystallized:** *Instrumentation is not a tax, it's the substrate that makes structural decisions truthful.* Every assumption about what a meta-controller "should do" or "is doing" must be measurable. Every `Candidate for removal` comment is a hypothesis waiting for data.

### Round 10: The retirement arc (2026-04-19, R11-R15)

With Round 9's measurement loop established, five rounds of data-driven decisions reshaped the hypermeta allowlist. This is the arc.

**Numeric journey:**

| Round | LEGACY_OVERRIDES | Invariants PASS | HCI | What happened |
|-------|------------------|-----------------|-----|---------------|
| R11   | 6                | 145/145         | 95.1 | Instrumentation added (`perLegacyOverride` fire counts) |
| R12   | 6                | 151/153         | 96.4 | Entry counts added, first round of 2x zero-fire data |
| R13   | 5                | 155/155         | 96.4 | `entropy-cap-0.19` retired — 1st data-driven removal |
| R14   | 5                | 155/156         | 96.4 | Cascade direction bug fixed (`buildAdjacency` from→to) |
| R15   | **2**            | 156/158         | 96.4 | `phase-trust-seesaw` + 2 graduated retired; cascade validated (accuracy 0.005→0.333, 66x) |

**What was retired:**
- `entropy-cap-0.19` (R13) — 2 zero rounds; generic `AXIS_OVERSHOOT` at 0.22 covers
- `phase-trust-seesaw` + `-graduated-0.02` + `-graduated-0.04` (R15) — 5 zero rounds; phaseFloorController + trustStarvationAutoNourishment cover

**What was kept, data-proven:**
- `tension-floor-0.15` — 4-23 fires/round, load-bearing
- `trust-floor-0.14` — 13-42 fires/round (up to 57% of trust-axis adjustments), load-bearing

Both "keepers" had comments saying "Candidate for removal" that instrumentation contradicted. The comments came from pre-measurement intuition about what should be retired; the data said the intuition was wrong.

**Meta-pattern codified (`metrics/legacy-override-retirement-log.jsonl`):**

```
retire:  {id, rounds_observed_zero, reason, fallback_handler, retired_in, commit}
keep:    {id, action:"keep", rounds_observed, reason, decision_in, decision_type}
```

Every decision is an audit entry. The retirement log itself becomes the measurement of the measurement process — did we remove the right ones? The generic controller chain keeps working post-removal, so: yes.

**Observability side-effects:**
- R14 cascade direction fix made recall calculable at all (was structurally 0).
- R15 self-prediction gap identified: edited file wasn't in its own prediction set (addressed R16).
- `coherence-tracks-musical-outcome` invariant crossed n=10 activation but remains degenerate (verdict_numeric collapses to 1.0 for all STABLE; `hci_normalized` added R16 as real-variance anchor).

**Principle crystallized:** *The allowlist is not a compromise surface. It's a measurement output.* Every entry is either data-proven load-bearing or data-proven unused. There is no "probably needed" category anymore — only "fires N times per round" or "has fired zero times for N rounds." Future additions must enter through the same measurement gate.

### Round 11: The four-arc framework (R18-R22)

Through R17 the substrate was tactical: seven independent observability systems, each catching one kind of bug. Starting R18 the framework became strategic. Four arcs now interlock:

**Arc I — Cross-Substrate Consensus** (R18, `compute-consensus.js`). Seven voters, each producing a bounded scalar in [-1, +1] for "is this round healthy." Mean is the consensus score; stdev is the divergence signal. When substrates DISAGREE, that disagreement is more informative than any individual substrate's verdict.

**Arc II — Pattern Registry** (R20, `tools/HME/patterns/`). Meta-patterns codified as declarative JSON: trigger condition, measurement phase, decision gate, action steps, precedent history. The retirement arc (R13, R15) becomes `retire-legacy-override-after-5-zero-rounds.json`. The cascade-direction-fix (R14) becomes `validate-cascade-direction.json`. Every future round, the matcher evaluates all patterns and produces an action queue.

**Arc III — Inverse Reasoning** (R21, `compute-legendary-drift.py`). Each pipeline round snapshots 14 state dimensions into `metrics/hme-legendary-states.jsonl`. Envelope = median + stdev per field across history. Current round's per-field z-score surfaces outliers; mean |z| is the drift score. Fires BEFORE the listening verdict fails, catching state drift toward non-legendary territory preemptively.

**Arc IV — Meta-Measurement** (R19, `compute-invariant-efficacy.py`). The substrate measures itself. Each invariant classified from commit-log citations + recent fire state: load-bearing (cited and firing), load-bearing-historical (cited, currently passing), flappy (fires without citation), decorative (neither). First application retired `file-written-has-source-majority` (R22) as flappy.

**The emergent fifth behavior**: `propose-next-actions.py` (R22). Reads all four arcs' outputs and synthesizes a prioritized action queue. The shift from "agent proposes 10 ad-hoc suggestions per round" to "data proposes; agent executes." When all substrates agree there's nothing to do, the action queue is empty — a quiescent-healthy state is first-class observable.

**Cross-arc detectors** (R22): specific invariants for combinations. `cross-arc-hidden-drift-detector` fires when Arc I says agreement+healthy AND Arc III says drift AND Arc IV says invariants healthy — the exact hidden-drift scenario that motivated Arc III.

**Envelope shift tracking** (R22): compares the median-of-first-half vs median-of-second-half of snapshots. Large envelope shift = the "normal" state distribution itself is drifting (regime change), distinct from single-round drift. First observed: trust axis adjustments dropped 45% across R11-R22, signaling self-stabilization.

**Retirement pattern applied recursively**: entropy-cap-0.19 (legacy override, R13), phase-trust-seesaw (legacy override, R15), file-written-has-source-majority (invariant, R22). The same measurement-to-decision pattern works for code-level overrides AND measurement-level invariants. Fractal applicability.

**Principle crystallized**: *The four arcs are not four features — they're one nervous system.* Arc I detects substrate disagreement. Arc II prescribes actions. Arc III catches state drift. Arc IV measures the measurement. Together they produce the emergent behavior of data-driven action synthesis. Any one arc removed and the system collapses back to tactical bug-catching.

**The theorem** (conjectured, not proved): *any self-evolving creative system requires (1) a consensus mechanism across multiple measurement substrates, (2) a pattern registry of codified meta-patterns, (3) an inverse-reasoning envelope tracking historical success states, and (4) a meta-measurement layer that tracks which measurements earn their cost — and these four together produce emergent action-synthesis that the individual parts can't.* Polychron-HME is one instance; the structure is generic.

## The principle

Every implicit assumption about HME's correctness should become an explicit, scored measurement that the system can observe in itself. Every drift should be detectable before it confuses an agent. Every fix should reinforce the pattern that catches the next instance of the same drift. The goal is not perfection — it's **continuous observability of the system's distance from its own ideal state**, so we always know which way to walk.

This document will rot too. The verifier should catch that.

## The LIFESAVER no-dilution rule

LIFESAVER (the critical-error banner surfaced via `register_critical_failure()` and drained on every tool response) exists for exactly one reason: to be **intolerable until the root cause is fixed**. It is not a notification system. It is pain, by design.

This means:

1. **No cooldowns on LIFESAVER fires.** If a condition is real and recurring, LIFESAVER must fire every single time. Rate-limiting would hide the severity of the situation from the agent and allow the underlying problem to persist indefinitely.

2. **No deduplication, no throttling, no "seen this before" flags.** Each fire is a fresh reminder that the system is degraded.

3. **"False positive" LIFESAVER is itself a critical bug.** If an alert fires repeatedly for a condition that isn't actually a problem, the detector is wrong — and that is a **life-critical bug** to fix with the same urgency as the original. Silencing a false positive is worse than the false positive itself, because it dilutes every real alert that comes after.

4. **The only way to make LIFESAVER quieter is to fix the underlying condition.** Either:
   - The system state causing the fire is bad → fix the state, fire stops automatically
   - The detector is broken → fix the detector at full urgency, fire stops automatically

   Any path that involves adding a cooldown, a dedup set, a time-based guard, a "we already warned about this" flag, a `_last_fired_at` timestamp, or any other mechanism that suppresses the alert without eliminating its cause is a **subversion** and must be reverted.

### Enforcement: `LifesaverIntegrityVerifier`

The [LifesaverIntegrityVerifier](../tools/HME/scripts/verify-coherence.py) scans the call paths of `register_critical_failure` across:
- `tools/HME/mcp/server/rag_proxy.py`
- `tools/HME/mcp/server/context.py`
- `tools/HME/mcp/server/meta_observer.py`

It fails (weight 5.0, score 0.0 — enough to crater the HCI on its own) if any of these patterns appear near a LIFESAVER fire site:

- `cooldown` identifier in scope
- `_last_*_alert` timestamp variable
- `dedupe` / `_suppress` / `alerted_set`
- Time-based guard (`if now - X >= N:`) immediately before `register_critical_failure`

A PASS on this verifier means LIFESAVER is allowed to scream freely. A FAIL means someone introduced dampening and HCI tanks until it's reverted.

The verifier exists because this exact subversion was attempted once during construction — the "fix" for the high LIFESAVER rate was almost a 30-minute cooldown, which would have silenced the real symptom of HME's instability. The verifier is the immune system against that class of mistake recurring.

### What to do when LIFESAVER is loud

1. **Read the alert.** Don't dismiss.
2. **Identify the root cause.** Usually it's a sticky condition (slow tool response, degraded coherence, failing shim).
3. **Fix the root cause.** Not the detector. Not the alert. The CAUSE.
4. **LIFESAVER stops on its own** once the condition clears.

If after fixing you believe the detector was wrong, **that is itself a critical bug** — escalate it to the same urgency as the original. Do not add a cooldown. Fix the detector's logic so it correctly distinguishes the real condition from the false one.

This is the principle that keeps HME honest with itself.

### Detector fixes vs. alert dampening — examples

The line between "fixing the detector" (allowed) and "dampening the alert" (forbidden) is sometimes subtle. Concrete cases from the construction of this system:

**Allowed — detector calibration:**
- **Maturity gate on health_topology** ([rag_proxy.py](../tools/HME/mcp/server/rag_proxy.py)): the topology coherence metric is unreliable for the first ~50 readings (cold caches, async init, no baseline). Before that threshold, the detector cannot honestly claim "this is a problem." After 50 samples, alerts fire normally. This is **calibration**, not dampening: the detector stops claiming knowledge it doesn't have.
- **Crash-vs-reconnect distinction in restart_churn** ([meta_correlator.py](../tools/HME/mcp/server/meta_correlator.py)): MCP protocol restarts are normal. The original detector fired on `restarts >= 5 AND min_coherence < 0.5`, which conflated benign reconnects with crash loops. The fix adds `(shim_crashes >= 2 OR recovery_failures >= 3)` as a precondition. This is **detector accuracy**, not dampening: the detector now distinguishes the bad case from the benign case.
- **Baseline-relative latency verifier** ([verify-coherence.py](../tools/HME/scripts/verify-coherence.py)): absolute thresholds like "10 seconds is bad" don't generalize across hardware (local LLMs on amateur hardware naturally take 10+ seconds). The fix uses a rolling median per-machine baseline and only fires on a 3× regression from that baseline. This is **detector locality**, not dampening: it correctly distinguishes "slow for me" from "slower than I usually am."

**Forbidden — alert dampening:**
- **Time-based cooldown** (`if time.time() - last_fire >= 1800: register_critical_failure(...)`): suppresses real alerts to reduce noise. Hides ongoing problems from the agent. This was attempted once during construction and reverted.
- **Deduplication by event hash** (`if alert_id not in seen: register_critical_failure(...)`): same problem — silences re-occurrences of the same condition.
- **Severity downgrade** (`severity="INFO"` for what should be CRITICAL): hides the urgency. Allowed only when the *condition itself* is informational, not when it's a workaround for noise.

**The rule of thumb:** if your fix makes LIFESAVER quieter without changing whether the condition is actually present, it's dampening. If your fix makes LIFESAVER more accurate about when the condition is present (and quieter as a SIDE EFFECT), it's calibration.

The `LifesaverIntegrityVerifier` catches cooldowns and time-based guards near `register_critical_failure` calls. It does NOT catch sample-count-based maturity gates because those fix the detector, not the alert. The semantic distinction is encoded in what patterns the verifier looks for.



## The Full Stack (as of 2026-04-16)

Everything below is implemented, tested, and wired into the pipeline. Not aspirational.

### Infrastructure layer

**Inference proxy** (`tools/HME/proxy/hme_proxy.js`). Authoritative filter for all inference — Anthropic (default upstream), Groq, OpenRouter, Cerebras, Mistral, NVIDIA, Gemini, local llama.cpp. Multi-upstream routing via `X-HME-Upstream` header. Emergency valve self-disables after 3 consecutive upstream failures: writes `PROXY_EMERGENCY` to `hme-errors.log`, flips `HME_PROXY_ENABLED=0` in `.env`, kills itself. Coherence budget gates injection behavior — when coherence is ABOVE band, injection is suppressed to allow exploration. Two test suites: `test-proxy.sh` (9 mock tests) and `test-proxy-live.sh` (7 live API smoke tests).

**Activity bridge** (`metrics/hme-activity.jsonl`). 9 event types: `edit_pending`, `file_written`, `mcp_tool_call`, `pipeline_start`, `pipeline_run`, `round_complete`, `coherence_violation`, `inference_call`, `injection_influence`. Emitters: hooks (file edits, pipeline lifecycle), proxy (inference calls, violations, injections), `tools/HME/activity/emit.py` (CLI interface for any component).

**Policy engine** (`scripts/pipeline/check-hme-coherence.js`). Pre-composition pipeline step. Reads activity log, enforces coherence invariants, writes `metrics/hme-violations.json`.

### Self-awareness layer (pipeline steps)

| Step | Output | What it knows |
--
| `build-kb-staleness-index` | `kb-staleness.json` | Which modules' KB entries are stale/missing |
| `check-kb-semantic-drift` | `hme-semantic-drift.json` | Where KB descriptions diverge from code reality |
| `compute-coherence-score` | `hme-coherence.json` | How grounded this round's evolution was in the KB |

### Self-assessment layer

| Step | Output | What it measures |
--
| `generate-predictions` | `hme-predictions.jsonl` | Cascade impact predictions from dependency BFS |
| `reconcile-predictions` | `hme-prediction-accuracy.json` | Whether predictions matched actual fingerprint shifts |
| `compute-musical-correlation` | `hme-musical-correlation.json` | Whether HME coherence predicts musical quality |
| `compute-compositional-trajectory` | `hme-trajectory.json` | Whether musical complexity is growing, plateauing, or declining |

### Self-governance layer

| Step | Output | What it governs |
--
| `compute-coherence-budget` | `hme-coherence-budget.json` | Optimal coherence band — too high = over-disciplined, too low = chaotic |
| `compute-kb-trust-weights` | `kb-trust-weights.json` | Epistemic reliability of each KB entry |
| `compute-intention-gap` | `hme-intention-gap.json` | What keeps getting proposed but not finished |
| `derive-constitution` | `hme-constitution.json` | 39 constitutional claims about what Polychron essentially is |

### Meta-meta layer

| Step | Output | What it produces |
--
| `detect-doc-drift` | `hme-doc-drift.json` | Where documentation has diverged from KB knowledge |
| `extract-generalizations` | `hme-generalizations.json` | Project-agnostic patterns from crystallized KB |
| `synthesize-generalizations` | (updates generalizations) | Universal structural claims via reasoning cascade |
| `render-generalizations` | `doc/hme-discoveries.md` | Human-readable intellectual output |
| `compute-evolution-priority` | `hme-evolution-priority.json` | Ranked list of what should change next, from 9 signal sources |

### The compounding structure

These aren't independent features. Each feeds the next:

- Staleness feeds coherence score (stale-module writes are penalized)
- Coherence score feeds the budget (determines the optimal band)
- Budget feeds the proxy (gates injection behavior)
- Predictions feed accuracy (scored against pipeline fingerprints)
- Accuracy feeds trust weights (low accuracy = lower trust for that KB region)
- Trust weights feed the proxy (high-trust entries injected as principles, low-trust as hypotheses)
- Constitution feeds doc drift (constitutional claims checked against documentation)
- All 9 signals feed evolution priority (ranked self-direction)

The system's output at full expression: a ranked list of what it thinks should change, derived from its own assessment of where its knowledge is wrong, where its predictions fail, where the music is stalling, and where the architecture has structural gaps nobody designed into it.
