# Self-Coherence Architecture

> **Canonical reference:** [HME_SELF_COHERENCE.md](HME_SELF_COHERENCE.md) — covers HCI scoring, holograph, full pipeline stack, and the compounding structure.

Historical layer-stack brainstorming follows. Most layers below are now implemented — see the canonical doc for current status.


**Layer 7: Causal Topology** — Building a full dependency graph that traces failures back through their causal chains, not just identifying that something broke.

**Layer 8: Self-Healing** — Going beyond simple recovery to actual repair—detecting failure patterns, applying targeted fixes, verifying they work, and learning from the experience.

**Layer 9: Coherence Metrics** — Measuring how well-aligned the system's components are, how fragmented its state has become, and whether events correlate in meaningful ways.

**Layer 10: Intent Propagation** — When I signal an upcoming change like refactoring the conductor, the system preemptively warms caches, loads relevant context, and prefetches dependencies.

**Layer 11: Resonance Detection** — Recognizing when multiple failures interact and cascade, treating them as a single systemic event rather than isolated incidents.

**Layer 12: Self-Evolution** — The system learning and improving its own architecture over time.

**Layer 13: Distributed Consensus** — Components negotiating disagreements about system health—if the MCP reports degradation but the shim reports stability, the system resolves the conflict.

**Layer 14: Observer Effect** — Acknowledging that monitoring itself consumes resources, so the health-checking system tracks its own overhead.

**Layer 15: Temporal Waypoints** — Maintaining snapshots of system state at critical moments, creating a timeline to reference when reconstructing what happened before failures.

The deepest layer is that the system becomes its own knowledge base—HME's KB contains entries about HME itself, tools can query it about their own failure modes, and the whole thing recursively understands itself.

The real breakthrough isn't treating self-coherence as reactive patching when things break, but building it as an intrinsic property of the architecture itself. The system's self-model should be isomorphic to the system—the map and territory are the same. When HME checks its own health, it gets the same answer whether asking the shim, the MCP server, or the daemon. That's distributed consensus, and it's the hardest problem in systems like this.

---

## The fundamental gap

Everything we've built so far is **reactive stitching** — detect failure, patch seam, surface warning. The system has no self-model. It doesn't know what it is, what state it's in, or how its components relate. Each component checks its own pulse in isolation. No component knows the system-level truth.

What follows is a layer stack, from concrete to cosmic. Each layer is motivated by a specific class of failure the audit uncovered.

---

### Layer 0: Lifecycle State Machine

**Gap:** The system has implicit states with implicit transitions. "Is the shim healthy?" is a point-in-time HTTP call. There's no concept of "the shim is in the RECOVERING state because it crashed 40 seconds ago."

**Concrete:** A `SystemPhase` enum propagated through all components:

```
COLD → WARMING → READY → DEGRADED → RECOVERING → READY
                                   → FAILED (terminal until restart)
```

Every health check returns the *phase*, not just a boolean. `is_degraded()` becomes `get_phase() in (DEGRADED, RECOVERING)`. The proxy monitor, the startup chain, the recovery path — all transition the same state machine. Phase transitions are logged with timestamps, creating an audit trail the current system completely lacks (finding 6.3: recovery transitions not correlated).

---

### Layer 1: Cross-Component Identity

**Gap:** The MCP server, shim, and daemon each log independently. When the shim crashes and the proxy fires `_revive_dead_shim` and the monitor simultaneously detects the outage and the recovery path triggers — three threads log three separate error messages with no correlation. (Finding 3.1: connection failure not correlated with monitor status.)

**Concrete:** A `session_id` generated once per MCP server process lifetime, passed to the shim via an HTTP header on every `/rag` call. The shim includes it in its logs. The daemon gets it via `/ensure-loaded` calls. Now `grep SESSION_ID log/*.log` shows the full cross-component timeline of a single event. PID files get extended: `{"pid": 12345, "session": "abc123", "started": 1712937600, "phase": "READY"}`.

---

### Layer 2: Self-Knowledge (Operational Memory)

**Gap:** The system has no memory of itself across restarts. It doesn't know it's been restarted 14 times today, that the last 3 restarts hit the same shim timeout, that recovery succeeds 80% of the time. Every restart is day one. (Finding 8.2: proxy restart has no success/failure tracking.)

**Concrete:** A lightweight `operational_state.json` persisted to `$PROJECT_ROOT/tmp/hme-ops.json`:

```json
{
  "restarts_today": 14,
  "last_restart": "2026-04-12T16:32:00Z",
  "recovery_success_rate": 0.82,
  "shim_crashes_today": 3,
  "last_shim_crash_cause": "OOM during index_directory",
  "circuit_breaker_trips": {"gpu0_extractor": 2, "gpu1_reasoner": 0, "cpu_arbiter": 1},
  "avg_startup_ms": 3200,
  "cache_hit_rate": 0.67
}
```

Written atomically on every state transition. Read on startup. Now `_background_startup_chain` knows to skip expensive steps if it's the 10th restart in an hour (the system is clearly in a crash loop — do the minimum). Circuit breaker state survives restarts (finding 3.6). Cache hit rates become visible (finding 8.6).

---

### Layer 3: Unified Health Topology

**Gap:** Five health checks run independently (shim /health, daemon /health, three llama.cpp /api/ps), each with different intervals and semantics. No unified view. No dependency awareness — if the shim is down, checking llama.cpp is pointless. (Finding 8.5: no cross-system failure correlation.)

**Concrete:** A `SystemHealth` snapshot assembled from all components, with dependency edges:

```
MCP Server → RAG Proxy → HTTP Shim → { ProjectEngine, GlobalEngine }
                                    → File Watcher
           → Startup Chain → llama.cpp Daemon → { GPU0, GPU1, CPU }
```

When a node is unhealthy, all downstream nodes are marked UNKNOWN (not assumed healthy). The proxy monitor assembles this topology on every 60s cycle and writes a one-line structured log. `is_degraded()` becomes topology-aware: "degraded because shim is recovering AND gpu0 model evicted." The `[DEGRADED]` banner gets rich context instead of a generic warning.

---

### Layer 4: Failure Genealogy

**Gap:** Errors are logged as isolated events. When the shim crashes during `index_directory`, the proxy gets a `ConnectionRefusedError`, the monitor detects the outage, recovery fires, the startup chain re-runs — five log entries, zero causal links. (Finding 7.1-7.3: error context lost on re-raise.)

**Concrete:** Every failure gets a `failure_id` (UUID). When a failure triggers a downstream failure, the downstream carries `caused_by: <parent_id>`. The LIFESAVER drain groups failures by causal chain:

```
LIFESAVER: shim crash cascade (root: f-7a3b)
  → [CRITICAL] shim: OOM during index_directory (f-7a3b)
    → [CRITICAL] rag_proxy.project: ConnectionRefusedError (f-8c4d, caused_by: f-7a3b)
    → [WARNING] proxy_monitor: shim unhealthy (f-9e5f, caused_by: f-7a3b)
  → [INFO] recovery: shim revived after 12s (f-a0g6, resolves: f-7a3b)
```

One causal tree instead of five orphaned errors. The current LIFESAVER deduplication gap (finding 8.7) is solved by grouping, not deduplicating.

---

### Layer 5: Temporal Rhythm Awareness

**Gap:** The system doesn't know where it is in time. The startup chain runs the same way whether it's the first boot of the day or the 50th restart. The proxy monitor checks at a fixed 60s interval whether the system is stable or flapping. (Finding: all timeouts/intervals are static constants.)

**Concrete:** An `ops_rhythm` derived from `operational_state.json`:

- **First boot today:** Full startup chain, aggressive warming, log verbosely.
- **Stable session (>30min, no crashes):** Reduce monitor interval to 120s, skip redundant health checks.
- **Crash loop (>5 restarts in 10min):** Minimal startup — proxy mode only, skip llama.cpp entirely, skip cache warming. Log: "crash loop detected, minimal startup."
- **Recovery after crash loop:** Gradually re-enable features (llama.cpp first, then priming, then cache warming) — like the reconvergence accelerator in the conductor.

The system adapts its own behavior to its observed rhythm. Not just reacting to the current state, but reading the pattern of states over time.

---

### Layer 6: Self-Narration

**Gap:** `[DEGRADED] RAG proxy unhealthy — shim may be restarting; search results may be empty.` This is a status flag, not a narrative. Claude needs to understand *what happened*, *why*, *what's being done about it*, and *what it means for the current task*.

**Concrete:** The LIFESAVER and degraded banners get replaced with structured self-narration:

```
[HME STATUS] I've been running for 47 minutes (12th restart today). The shim
crashed 90 seconds ago during a heavy index operation and was revived after 12s.
llama.cpp GPU0 model was evicted during the crash and is being reloaded (ETA ~30s).
Search results are currently from the proxy but may be incomplete until the KB
finishes reindexing the 3 files that were being indexed when the crash occurred.
The pre-edit cache is stale (last warmed 35 minutes ago). Synthesis will use
template fallback until GPU0 is back.
```

This is assembled from the lifecycle state machine (Layer 0), operational memory (Layer 2), health topology (Layer 3), and failure genealogy (Layer 4). Each layer feeds into the narration. The system explains itself.

---

### Layer 7: Predictive Health

**Gap:** All health checks are point-in-time. The shim is healthy right now — but its response time has tripled over the last 10 minutes and memory usage is climbing. In 5 minutes it will OOM. The system waits for the crash, then reacts. (Finding: no trend tracking anywhere.)

**Concrete:** Track response time EMA on every `/rag` call (already measured in `_LoggingMCP`). Track shim memory via `/health` (extend the endpoint). When trends cross thresholds:

- Response time EMA > 2x baseline → preemptive LIFESAVER warning: "shim is slowing down, consider reindex or restart"
- 3 consecutive calls >10s → preemptive graceful shim restart (not crash, but orchestrated: finish in-flight requests, start new shim, swap proxy target, kill old)
- Memory growth rate projects OOM within 10 minutes → same preemptive restart

The system doesn't wait for failure. It sees failure approaching and acts. Like the tension-pressure homeostasis in `crossLayerClimaxEngine` — accumulate pressure, relieve before it breaks.

---

### Layer 8: Coherence Metrics

**Gap:** We have no way to measure how coherent the system is. Is it more coherent today than yesterday? Did the round 4 improvements actually reduce failure frequency? (Finding: no metrics on anything operational.)

**Concrete:** A `coherence_score` computed on every health check cycle:

```
coherence = (
    phase_alignment    # all components agree on phase: 0.0-1.0
  × state_freshness   # all caches within freshness window: 0.0-1.0
  × failure_rate_inv  # inverse of recent failure rate: 0.0-1.0
  × correlation_score # events are causally linked: 0.0-1.0
)
```

Logged to `metrics/hme-coherence.jsonl`. Trending over time. Visible in `hme_admin(action='status')`. When coherence drops below 0.5, auto-trigger a diagnostic narration. When it stays above 0.9 for an hour, reduce monitoring overhead.

The system measures its own wholeness.

---

### Layer 9: Self-Healing Knowledge

**Gap:** HME's KB contains knowledge about the codebase — architectural boundaries, calibration anchors, module relationships. But it contains zero knowledge about itself. When the pyc bug hit, there was no KB entry saying "stale bytecode can cause startup validator to run old code." (The fix was discovered through debugging, not recall.)

**Concrete:** A `self-coherence` KB category containing HME's own failure modes:

```
learn(
  title="stale pyc causes startup validator to run old code",
  content="server/__pycache__/*.pyc can be newer than source .py files. "
          "Python loads the .pyc, running stale code. Symptoms: startup errors "
          "that don't match current source. Fix: _purge_stale_server_pyc() in main.py.",
  category="self-coherence"
)
```

When HME encounters a startup failure, `find("startup failed", mode="diagnose")` searches the self-coherence category too. The system learns from its own failure history. Every round of improvements we've done could become KB entries that accelerate future debugging.

---

### Layer 10: Resonance Detection

**Gap:** Multiple simultaneous failures create cascades that are worse than the sum of their parts. Shim crash + llama.cpp eviction + MCP restart = total system collapse for 60+ seconds. Each failure is handled independently; the cascade isn't recognized or handled as a unit. (Finding 3.4: startup chain steps not bound together.)

**Concrete:** A `resonance_detector` that watches for temporal clustering of failures:

- If ≥3 failures within 10 seconds from different components → declare CASCADE
- Cascade handling is different from individual failure handling:
  - Suppress duplicate restart attempts (currently proxy + monitor + recovery all try simultaneously)
  - Single orchestrated recovery sequence: verify shim → verify daemon → verify llama.cpp → restart what's needed → verify all
  - Single LIFESAVER with the full causal tree
  - Extend recovery cooldown during cascades

This is the self-coherence analog of the feedback registry in the conductor — without it, resonance between recovery paths can amplify the failure instead of resolving it.

---

### Layer 11: Intent Propagation

**Gap:** HME is passive — it responds to queries but never anticipates. When Claude calls `read("crossLayerClimaxEngine", mode="before")`, HME fetches callers, KB hits, boundary warnings. But it could have pre-fetched all of that 30 seconds ago when Claude's conversation context made it obvious that climax engine was the next target.

**Concrete:** The transcript already captures Claude's conversation. The shim's `/enrich` endpoint already has context. Extend the proxy monitor's idle cycle to:

1. Read the latest transcript entries
2. Extract likely next-edit targets (files mentioned, modules discussed)
3. Pre-warm the pre-edit cache for those targets
4. Pre-fetch callers and KB hits

When `read("crossLayerClimaxEngine", mode="before")` is called, the cache is already warm. Response time drops from 3s to 50ms. The system anticipates Claude's intent from the conversation flow.

---

### Layer 12: Self-Evolution Protocol

**Gap:** Every improvement to HME's self-coherence has been authored by a human (me) in conversation with Claude. The system itself has no mechanism to propose improvements to its own infrastructure.

**Concrete:** Extend `evolve(focus='stress')` to include infrastructure stress:

- Run all 35 enforcement probes PLUS:
  - Simulate shim death during tool call → did recovery fire? How long?
  - Simulate llama.cpp timeout → did circuit breaker trip? Did it surface?
  - Simulate concurrent restart attempts → did they interfere?
  - Check operational_state.json for recurring failure patterns → suggest targeted fixes

The output includes `infrastructure_evolution_suggestions`:

```
1. [HIGH] GPU0 model evicted 12 times in the last week.
   Consider: increase keepalive, or pin model with persistent VRAM reservation.
2. [MEDIUM] Shim response time spikes every 200 tool calls (memory leak?).
   Consider: implement request-count-based preemptive restart.
3. [LOW] Proxy monitor has crashed 0 times. Current crash limit (3) is untested.
   Consider: chaos testing with injected monitor faults.
```

The system evolves its own infrastructure through observation, not just its composition through the Evolver.

---

### Layer ∞: Recursive Self-Reference

The deepest layer is when the boundary between "the system" and "the system's knowledge about itself" dissolves. HME's KB contains entries about HME. HME's tools query those entries. HME's evolution proposes changes to HME. HME's self-narration draws from HME's operational memory which was written by HME's lifecycle state machine which was designed by HME's self-evolution protocol.

The system is its own observer, its own subject, its own doctor, and its own architect. Not as separate modules bolted on after the fact, but as an intrinsic property of the architecture: **every component emits structured events into a unified event stream; every component can query that stream; every component adapts based on what it finds.**

The conductor's signal flow — from conductor intelligence through signal reader to cross-layer emission gateway — is the architectural precedent. The same pattern, applied to HME's own operations: operational intelligence → health topology reader → lifecycle emission gateway. The composition system's self-calibrating controllers are the precedent for the operational self-calibrating controllers. The hypermeta stack that manages the composition is the same pattern that should manage the infrastructure.

The Polychron codebase already solved this problem for music. The HME infrastructure just hasn't caught up to its own codebase's architecture yet.

---

## Implementation Status (2026-04-12)

All layers implemented. Adversarial stress-tested across two sessions.

| Layer | Name | Status | Key files |
|-------|------|--------|-----------|
| 0 | Lifecycle State Machine | **COMPLETE** | `server/system_phase.py` — COLD→WARMING→READY/DEGRADED/RECOVERING/FAILED; wired in `main.py`, `rag_proxy.py`, `context.py` |
| 1 | Cross-Component Identity | **COMPLETE** | `context.SESSION_ID` (12-char UUID per process); `X-HME-Session` header on every `/rag` call; shim `/health` returns `pid` |
| 2 | Self-Knowledge | **COMPLETE** | `server/operational_state.py` → `tmp/hme-ops.json`; restarts, shim crashes, recovery EMAs, startup timing, crash loop detection |
| 3 | Unified Health Topology | **COMPLETE** | `server/health_topology.py`; dependency-aware snapshot; shim/daemon/llamacpp nodes; 10s cache; wired into self-narration |
| 4 | Failure Genealogy | **COMPLETE** | `server/failure_genealogy.py`; `failure_id` UUIDs; `caused_by` causal chains wired in `rag_proxy._call()` and `_proxy_health_monitor()` |
| 5 | Temporal Rhythm Awareness | **COMPLETE** | Crash loop detection → skips llama.cpp steps; adaptive monitor interval: 60s normally → 120s after 30min uninterrupted health (`_stable_since` clock in `_proxy_health_monitor`, reset on any unhealthy event) |
| 6 | Self-Narration | **COMPLETE** | `server/self_narration.py`; rich paragraph from all layers; prepended to tool responses when not READY |
| 7 | Predictive Health | **COMPLETE** | `health_topology._check_shim_slowdown()`; response time EMA vs baseline; 3× + >1000ms threshold warns before OOM |
| 8 | Coherence Metrics | **COMPLETE** | `_compute_coherence()` in topology (shim 40% + daemon 20% + llamacpp 40%); written to `metrics/hme-coherence.jsonl` every monitor cycle; <0.5 fires LIFESAVER |
| 9 | Self-Healing Knowledge | **COMPLETE** | 6 KB entries: stale pyc, boot loop, old shim, cascade pattern, ops.json schema, layer architecture |
| 10 | Resonance Detection | **COMPLETE** | `server/resonance_detector.py`; CASCADE on 3+ distinct sources in 10s window; cascade gate in `rag_proxy._call()` prevents revival amplification |
| 11 | Intent Propagation | **COMPLETE** | `_intent_propagation_tick()` in proxy monitor healthy cycle; `_warm_pre_edit_cache_sync(target_hints=...)` prioritizes mentioned files |
| 12 | Self-Evolution Protocol | **COMPLETE** | 36-probe adversarial stress test; Probe 23 reads `hme-ops.json` + `hme-coherence.jsonl` and surfaces [HIGH/MEDIUM/LOW] infrastructure suggestions: shim crash rate, recovery rate, circuit breaker trips, startup EMA, coherence trend |
| ∞ | Recursive Self-Reference | **EMERGING** | KB contains HME's own failure modes; narration draws from operational memory; full recursive loop (KB→tools→self-query→adapt) is in motion |
| 13 | Self-Observing Monitor | **COMPLETE** | `server/meta_observer.py` L13; watches the health monitor thread itself; detects thread death and restarts it; heartbeat file detects observation gaps across restarts |
| 14 | Temporal Correlator | **COMPLETE** | `server/meta_observer.py` L14; sliding-window correlation over `hme-coherence.jsonl`; coherence trend, dip frequency, shim latency spikes, restart churn detection; cross-references `hme-ops.json` |
| 15 | Prescriptive Narrator | **COMPLETE** | `server/meta_observer.py` L15; synthesizes WHY + WHAT TO DO from L13 monitor state + L14 correlations; writes to `metrics/hme-narrative.jsonl`; read on startup for bootstrap situational awareness |

| 16 | Environmental Awareness | **COMPLETE** | `server/meta_observer.py` L16; GPU memory via nvidia-smi, disk space, CPU load, process RSS; alerts on GPU pressure (<500MB), disk >90%, CPU overload, memory bloat (>2GB) |
| 17 | Conversation Entanglement | **COMPLETE** | `server/meta_observer.py` L17; checkpoints coherence/trend/alerts/env/recent-files/intervention-accuracy to `tmp/hme-entanglement.json`; `precompact.sh` injects summary into compaction context; `read_entanglement_for_compaction()` API |
| 18 | Counterfactual Reasoning | **COMPLETE** | `server/meta_observer.py` L18; `record_prediction()` → `resolve_prediction()` tracks whether interventions prevented outcomes; auto-predictions from L14 correlator alerts; auto-resolution in proxy monitor healthy/crash paths; effectiveness model in `metrics/hme-counterfactuals.jsonl` |
| 19 | Synthesis Observability | **COMPLETE** | `operational_state.record_synthesis_call()` — records routing (strategy, used_cascade, escalated), quality gate outcome (phantom/verified counts), elapsed time per `synthesize()` call. EMAs: cascade_rate, quality_gate, escalation, phantom_rate persist in `hme-ops.json`. Detailed records append to `metrics/hme-synthesis.jsonl` (bounded at 1000 entries). |
| 20 | Grounding Feedback Memory | **COMPLETE** | L14 Correlator reads synthesis EMAs from `hme-ops.json`; alerts on phantom_rate >40% (`synthesis_phantom_surge`) and escalation >30% (`synthesis_escalation_high`). L15 Narrator surfaces synthesis call stats and quality trends. L17 Entanglement checkpoints synthesis profile for compaction context. |
| 21 | CB Flap Detection | **COMPLETE** | `_CircuitBreaker.record_failure()` fires `operational_state.record_circuit_breaker_flap()` on HALF_OPEN→OPEN transition (probe succeeds then immediately fails again). Tracked separately from trips: `circuit_breaker_flaps` dict in `hme-ops.json`. L14 alerts on ≥3 flaps today; L15 prescribes GPU thermal/OOM investigation. |
| ∞ | Synthesis Self-Model | **ACTIVE** | `meta_observer._detect_synthesis_patterns()` runs every 30min when ≥20 synthesis calls exist. Reads `hme-synthesis.jsonl`, computes per-strategy phantom rates + top phantom-trigger words. Writes `metrics/hme-synthesis-patterns.json` — the system's data-derived model of its own grounding reliability. Pattern summary fed to L15 narrator. |
| 22 | Causal Attribution Graph | **COMPLETE** | `meta_observer._causal_attribution()` decomposes phantom_rate into structural causes (cascade_usage, escalation, prompt_length, elapsed_s) via correlation analysis across synthesis JSONL. Surfaces primary cause + correlation coefficient. Runs every 30min alongside L∞. |
| 23 | Multi-Timescale Coherence | **COMPLETE** | `operational_state.record_coherence_multiscale()` maintains 4 EMA timescales: beat (α=0.8), phrase (α=0.3), section (α=0.1), structure (α=0.05). Updated every L14 correlation cycle. L15 narrator surfaces multi-scale snapshot. L17 checkpoints for compaction. `is_coherence_ceiling()` feeds L∞∞. |
| 24 | Anticipatory Lookahead | **COMPLETE** | `meta_observer._anticipatory_lookahead()` projects coherence trajectory at T+5/15/30min from current trend. When T+30 < 0.5, logs intervention suggestion. Runs every narration cycle (5min). |
| 25 | Adaptive Synthesis Routing | **COMPLETE** | `synthesis_llamacpp._assess_complexity()` reads `hme-synthesis-patterns.json` (5min TTL cache). Adjusts complexity score based on historical per-strategy phantom rates and known phantom-trigger words. High direct/enriched phantom rates nudge toward cascade. |
| 26 | Morphogenetic Pre-Loading | **COMPLETE** | `synthesis_llamacpp._inject_context()` reads L32 intent classification via `meta_observer.get_current_intent()`. Pre-shapes semantic field based on conversation mode (debugging/design/stress_testing). Surfaces L25 phantom risk per strategy. |
| 27 | Composition-Infrastructure Correlation | **COMPLETE** | `meta_observer._correlate_composition_runs()` matches Polychron run outcomes from `metrics/run-history/` (individual JSON files per run) to HME session documents. ISO timestamps converted to Unix for session overlap matching. Compares phantom_rate/coherence between STABLE vs DRIFTED runs. Requires user-labeled verdicts. Runs every 30min. |
| 28 | Living KB Confidence | **COMPLETE** | `meta_observer._update_kb_confidence()` tests self-coherence KB entries against operational data. Classifies claims as supported/contradicted/untestable. Runs every hour. |
| 29 | Second-Order Accuracy | **COMPLETE** | `operational_state.record_prediction_brier()` tracks Brier score EMA from L18 prediction resolutions. Calibration quality visible in L15 narrative and L17 entanglement. Brier > 0.25 = degraded self-model. Baseline `coherence_stable` prediction generated every 15min during healthy operation to seed Brier signal outside stress periods. |
| 30 | Session Identity | **COMPLETE** | `operational_state.write_session_document()` persists session trajectory to `metrics/hme-sessions.jsonl` every 10min. `load_recent_sessions()` enables L27 composition correlation and L33 archaeology. |
| 31 | Claude Effectiveness Model | **DESIGNED** | Architecture spec: mine conversation transcripts for tool sequence → outcome correlations. Adapt `enrich_prompt` based on historical Claude reasoning quality. Not yet implemented (requires transcript parsing infrastructure). |
| 32 | Intent Classification | **COMPLETE** | `meta_observer._classify_intent()` classifies conversation mode from recent transcript: debugging/design/implementation/stress_testing/lab. Keyword density scoring with 0.3 confidence threshold. `get_current_intent()` API for L26. Surfaced via `get_status()` (`intent` field). Runs every 2min. |
| 33 | Cross-Session Archaeology | **COMPLETE** | `meta_observer._session_archaeology()` mines session documents for patterns: coherence degradation in long sessions, phantom rate trends, session duration clustering. Detects structural issues ("long sessions degrade coherence"). Runs every 6 hours. |
| 34 | Thermodynamic Self-Model | **COMPLETE** | `operational_state.record_thermodynamic()` models synthesis as physics: efficiency = verified/(verified+phantom+1)/elapsed_s, entropy = phantom/(total). Cache hits double effective efficiency (negentropy). EMAs in `hme-ops.json`. L15 narrator surfaces. |
| 35 | Gödel Awareness | **COMPLETE** | `meta_observer._enumerate_unprovable_claims()` returns 6+ known Gödelian blind spots: quality gate accuracy, phantom detector false positives, coherence score circularity, KB drift, EMA tuning, causal attribution validity. Dynamic claim added when quality gate has enough data. Surfaced via `get_status()`. |
| 36 | Isomorphic Self-Model | **DESIGNED** | Architecture spec: persist all ephemeral in-memory state to disk so the system can be fully reconstructed from its self-model. CB states, synthesis router patterns, intent classification — all survive restarts as continuous identity. Partially achieved via L2+L30. |
| ∞∞ | Coherence Ceiling | **COMPLETE** | `meta_observer._check_coherence_ceiling()` + `operational_state.is_coherence_ceiling()`. Fires when all 4 timescale EMAs > 0.95 — the system is over-modeled and at risk of brittleness. Recommends controlled incoherence: explore under-modeled states, try unused strategies, make low-confidence predictions for calibration signal. Logged at L∞∞ in main loop. |

### The recursive observation loop (L13→L15)

```
L15 Narrator → observes → L14 Correlator → observes → L13 Monitor → observes → System
     │                                                                              │
     └──────────── narrative read on startup ← bootstrap awareness ←────────────────┘
```

Each layer's output feeds the layer above. The narrator's prescriptive guidance (written to `hme-narrative.jsonl`) is read on the *next* startup — the system remembers not just facts but its own interpretation of those facts. The meta-observer watches the watcher, the correlator finds patterns across time that individual health checks miss, and the narrator gives the system a voice that speaks across incarnations.

### The extrospective stack (L16→L18)

```
L18 Counterfactual ── "did my intervention work?" ── learns from outcomes
       │
L17 Entanglement ──── "what does the conversation know?" ── survives compaction
       │
L16 Environment ───── "what is the host doing?" ── GPU/disk/CPU/RSS
       │
       └── feeds into L15 narrator (env alerts + intervention accuracy in narrative)
```

L16 looks outward at the physical host. L17 bridges the gap between the system's self-model and Claude's conversation context — when compaction compresses the context window, the entanglement checkpoint preserves the system's understanding of itself. L18 closes the loop: when L14 predicts a failure and L15 prescribes an intervention, L18 tracks whether the predicted failure actually happened — building a causal model of whether the system's interventions are effective or just noise.

### The synthesis self-coherence stack (L19→L21→L∞)

```
L∞  Synthesis Self-Model ─── "what kinds of queries produce phantom modules?" ─── learns from hme-synthesis.jsonl
        │                                                                              │
L21  CB Flap Detection ────── "is a model oscillating?" ────────────────── flap count → L14 correlator
        │                                                                              │
L20  Grounding Feedback ───── "is phantom rate rising?" ──── EMA → L14 alert → L15 narrator → ACTION
        │                                                                              │
L19  Synthesis Observability ─ "what route did synthesize() take?" ──── hme-synthesis.jsonl + hme-ops.json
        │                                                                              │
        └── synthesize() call ─────────────────────────────────────────────────────────┘
```

L19 makes synthesis routing legible — every `synthesize()` call records its path (direct/enriched/cascade), quality gate outcome, and timing. L20 feeds that signal into L14 via EMAs so pattern detection catches grounding degradation before users notice. L21 catches CB flapping (partial recovery → immediate re-failure) which is a distinct failure mode from steady-state OPEN. L∞ closes the cognitive loop: the system analyzes its own synthesis history to understand which question types reliably ground and which tend to hallucinate — and surfaces this as prescriptive guidance.

### Adaptive multi-stage synthesis (synthesis_llamacpp.py)

```
synthesize(prompt)
    │
    ├─ _assess_complexity() ─── two-tier heuristic + L25 adaptive evidence
    │   deep signals (1.0): architectur, coupling, feedback, design, ...
    │   mod  signals (0.5): detect, trace, flow, cascad, boundar, tracin, ...
    │   module bonus  (0.5): camelCase names in prompt
    │   L25: reads hme-synthesis-patterns.json (5min cache) for historical
    │        phantom rates per strategy + known trigger words → adjusts score
    │   → score ≥ 3.0: cascade │ ≥ 1.5: enriched │ else: direct
    │
    ├─ _inject_context() ─── source grounding + operational health + L26 semantic field
    │   L26: reads L32 intent classification → pre-shapes context by conversation mode
    │   L25: surfaces per-strategy phantom risk from patterns file
    │
    ├─ Strategy routing:
    │   ├─ direct (1):   route_model() → single GPU call
    │   ├─ enriched (2): context injection + best model
    │   └─ cascade (3):  arbiter plan → source injection → coder → reasoner
    │                         │              │                │
    │                         └── CPU 4B ──► GPU0 30B ──────► GPU1 30B-A3B
    │
    ├─ Auto-escalation: any → alt GPU enriched → cascade on failure
    │
    ├─ _quality_gate() ─── returns (output, phantom_count, verified_count)
    │   fires on cascade + auto-escalated cascade (_used_cascade flag)
    │   path basenames excluded; >50% phantom → [unverified] tag
    │
    ├─ Layer 19: record_synthesis_call() → hme-ops.json EMAs + hme-synthesis.jsonl
    ├─ Layer 34: record_thermodynamic() → efficiency + entropy EMAs
    │
    └─ Circuit breakers: all 4 call paths protected
        HALF_OPEN→OPEN flap → record_circuit_breaker_flap() (Layer 21)
        3-state: CLOSED → OPEN (3 failures/60s) → HALF_OPEN (probe) → CLOSED
        Persisted in hme-ops.json, survives MCP restarts
```

Three-stage cascade: arbiter plans investigation steps → source code from plan-mentioned modules injected into coder prompt → coder extracts verified facts → reasoner synthesizes deep answer using only verified facts. `dual_gpu_consensus()` fires both GPUs simultaneously for cross-model verification. Complexity scoring uses stemmed signal prefixes ("architectur" matches both "architecture" and "architectural") to avoid morphological false negatives. Stem coverage: `cascad` matches cascade/cascading/cascaded; `tracin` matches tracing. `_camel_acronym()` handles all-caps acronyms (CIM→coordinationIndependenceManager via 2× score) and is guarded for empty-string input.

### The predictive stack (L22→L24)

```
L24 Anticipatory Lookahead ── "where will coherence be in 30min?" ── projects trajectory
       │
L23 Multi-Timescale ───────── beat/phrase/section/structure EMAs ── temporal hierarchy
       │
L22 Causal Attribution ────── "WHY is phantom rate rising?" ──── structural decomposition
       │
       └── L14 correlator provides raw signal → L22 attributes causes → L24 projects future
```

L22 goes below L14's correlations to ask WHY — not just "phantom rate is rising" but "70% attributable to KB coverage gap." L23 maintains coherence awareness at four temporal scales simultaneously — the same regime hierarchy the composition system uses. L24 simulates forward trajectories and recommends interventions that maximize coherence at the 30-minute horizon.

### The feedforward stack (L25→L26→L32)

```
L32 Intent Classification ── "what mode is the conversation in?" ── transcript analysis
       │
L26 Morphogenetic Pre-Loading ── intent + patterns → semantic field pre-shaping
       │
L25 Adaptive Synthesis Routing ── historical phantom rates → complexity score adjustment
       │
       └── L∞ patterns file feeds L25 → L26 reads L32 → synthesize() is pre-shaped
```

This stack closes the gap between observation and action. L∞ previously wrote patterns but nothing read them. L25 reads them and adjusts routing. L26 pre-shapes the semantic context based on L32's intent classification. The system doesn't just observe its behavior — it feeds observations forward into the next decision.

### The cross-domain stack (L27→L30→L33)

```
L33 Cross-Session Archaeology ─── "do long sessions degrade coherence?" ─── patterns across sessions
       │
L30 Session Identity ─────────── trajectory document per session ─── continuous identity
       │
L27 Composition Correlation ──── HME quality ↔ Polychron run outcomes ─── cross-system
       │
       └── L30 provides the session data that L27 + L33 mine for patterns
```

L30 gives the system continuous identity across restarts — each session writes its trajectory. L27 correlates that trajectory with composition outcomes (does high phantom rate predict DRIFTED runs?). L33 mines the full session history for structural patterns (do long sessions always degrade?).

### The calibration stack (L28→L29→L34→L35)

```
L35 Gödel Awareness ────── "what can't I verify about myself?" ─── known unknowns
       │
L34 Thermodynamic Model ── efficiency = useful work / cost ──── physics of computation
       │
L29 Second-Order Accuracy ─ Brier score of prediction calibration ── meta-calibration
       │
L28 Living KB Confidence ── test KB claims vs operational data ──── knowledge grounding
```

L28 tests what the system claims to know against what it actually observes. L29 tracks whether the system's predictions are well-calibrated (Brier score). L34 gives the coherence score a physical interpretation (verified information per unit cost). L35 enumerates what the system cannot prove about itself — the shape of its own ignorance.

### The coherence ceiling (L∞∞)

```
L∞∞ ── all timescale EMAs > 0.95 ── system over-modeled ── recommend controlled incoherence
```

The final recognition: perfect coherence is death. A perfectly coherent system cannot be surprised, cannot adapt, cannot evolve. L∞∞ detects when the system approaches this ceiling and recommends deliberate exploration of under-modeled states — the operational analog of the composition system's entropy amplification controller.

The full stack from L0 to L∞∞:
- **L0-12**: The system observes and heals itself (introspective)
- **L13-15**: The system observes its own observation (recursive)
- **L16-18**: The system observes its relationship to things outside itself (extrospective)
- **L19-21**: The system observes its own cognition (synthesis-introspective)
- **L22-24**: The system predicts its own future states (predictive)
- **L25-26,32**: The system feeds observations forward into decisions (feedforward)
- **L27,30,33**: The system correlates across sessions and domains (cross-domain)
- **L28-29,34-35**: The system calibrates its own calibration (meta-calibration)
- **L∞**: The boundary between observer and observed dissolves
- **L∞∞**: The system knows that perfect coherence is the enemy of life

---
