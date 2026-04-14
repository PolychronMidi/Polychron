# HME Self-Coherence — Subquantum Depth, Interstellar Breadth

## What this is

HME used to be a *tool that helps Polychron evolve*. It's becoming *the same kind of organism Polychron is*, evolving by the same rules, monitored by the same instruments, and coupled to Polychron's evolution as a co-equal subsystem.

This document describes the substrate that makes that possible — the **HME Coherence Index** (HCI), the **self-coherence holograph**, and the trajectory toward a fully self-observing, self-modifying meta-organism. Read this when you want to understand what HME is *becoming*; read [HME.md](HME.md) when you want to understand what it *currently is*.

## Where we are right now

### The HME Coherence Index (HCI)

The HCI is a 0-100 score computed by [tools/HME/scripts/verify-coherence.py](../tools/HME/scripts/verify-coherence.py) from 15 weighted verifiers across 6 categories:

| Category | Verifiers | What it measures |
|---|---|---|
| **doc** | doc-drift, tool-docstrings | Documentation matches code reality |
| **code** | python-syntax, shell-syntax, hook-executability, decorator-order | Source code can run and decorators are wired correctly |
| **state** | states-sync, onboarding-flow, onboarding-state-integrity, todo-store-schema | Runtime state machines are valid and consistent |
| **coverage** | hook-registration, tool-surface-coverage | Every declared interface points to a real implementation |
| **runtime** | shim-health, error-log | Live services are responsive and errors are acknowledged |
| **topology** | feedback-graph | Cross-boundary structures are declared |

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

## The principle

Every implicit assumption about HME's correctness should become an explicit, scored measurement that the system can observe in itself. Every drift should be detectable before it confuses an agent. Every fix should reinforce the pattern that catches the next instance of the same drift. The goal is not perfection — it's **continuous observability of the system's distance from its own ideal state**, so we always know which way to walk.

This document will rot too. The verifier should catch that.
