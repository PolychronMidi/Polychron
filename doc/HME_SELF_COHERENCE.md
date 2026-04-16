# HME Self-Coherence — Subquantum Depth, Interstellar Breadth

## What this is

HME used to be a *tool that helps Polychron evolve*. It's becoming *the same kind of organism Polychron is*, evolving by the same rules, monitored by the same instruments, and coupled to Polychron's evolution as a co-equal subsystem.

This document describes the substrate that makes that possible — the **HME Coherence Index** (HCI), the **self-coherence holograph**, and the trajectory toward a fully self-observing, self-modifying meta-organism. Read this when you want to understand what HME is *becoming*; read [HME.md](HME.md) when you want to understand what it *currently is*.

## Where we are right now

### The HME Coherence Index (HCI)

The HCI is a 0-100 score computed by [tools/HME/scripts/verify-coherence.py](../tools/HME/scripts/verify-coherence.py) from **38 weighted verifiers** across 6 categories:

| Category | Verifiers (partial list — 38 total) | What it measures |
|---|---|---|
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
- **Cross-project KB sync.** The global KB at `~/.claude/mcp/HME/global_kb` is currently tiny. Auto-promote pattern entries from project KBs to global, with consent. Patterns learned in Polychron propagate to other projects.
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
|---|---|
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
|---|---|---|---|
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
