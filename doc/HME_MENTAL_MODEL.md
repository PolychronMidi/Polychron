# HME — Mental Model

The one-page picture you need before reading anything else. Read this once, then `i/state`, then start working. Everything else is a footnote.

## What HME is, in one sentence

HME is a self-coherence substrate that watches both Polychron's musical evolution and its own evolution at the same time, surfacing both as numeric signals an agent (you) can read, act on, and learn from.

## The two coherences

Two parallel scores, both 0-100ish, both moving over rounds:

- **Musical coherence.** How well does the composition cohere? Measured by `output/metrics/fingerprint-comparison.json` → `STABLE` / `EVOLVED` / `DRIFTED`.
- **Self-coherence (HCI).** How well does HME's own observation surface cohere? Measured by `tools/HME/scripts/verify-coherence.py` → 0-100, aggregated from 65 weighted verifiers.

Polychron is the *thing being made*. HME is *the awareness of how it's being made*. Both have a coherence number. Both numbers move together over rounds. Improving one improves the other. The agent's job is to nudge both upward.

## The four surfaces an agent talks to

```
  you (the agent)
   |
   +-> i/<wrapper> shell calls
   |     |
   |     +-> HME MCP server (tool surface, chained onboarding fsm)
   |
   +-> Edit / Write / Read / Bash (Claude-native tools)
         |
         +-> proxy middleware
         |     enriches tool results before you see them
         |
         +-> pretooluse hooks
         |     gate, correct, redirect
         |
         +-> posttooluse hooks
               track and advance state
```

You never call the MCP server directly. You either:

- run `i/<wrapper>` (a thin bash script that routes to MCP), or
- use Claude-native tools (Edit, Write, Read, Bash) which the proxy middleware intercepts and enriches.

The proxy and hooks are the *only* difference between "talking to an LLM" and "talking to HME-augmented tooling."

The MCP server, proxy, and hooks all read/write a shared substrate: KB (LanceDB), activity log (JSONL), state files (`tmp/hme-*`), per-run metrics (`output/metrics/`).

## The five state machines you live inside

- **Onboarding** — `tmp/hme-onboarding.state`. Drives which gates fire (boot → graduated).
- **NEXUS lifecycle** — `tmp/hme-nexus.state`. Drives review/commit nudges.
- **Pipeline lock** — `tmp/run.lock`. Mid-pipeline write blocks.
- **Fingerprint verdict** — `output/metrics/fingerprint-comparison.json`. STABLE/EVOLVED/DRIFTED.
- **KB freshness** — `tools/HME/KB/*.lance` mtime. Staleness verifier.

`i/state` consolidates all five in one ~10-line view. Always check it first when you lose your place.

## The four enforcement layers (and where to look when one fires)

- **Hooks** (bash) — `_proxy_bridge.sh` dispatches to `pretooluse_*.sh` / `posttooluse_*.sh`. Fires every Tool call. Inspect via `tools/HME/hooks/` and `i/why mode=block`.
- **Policies** (JS) — `tools/HME/policies/builtin/*.js`. Fires every Tool call (proxy-side). Inspect via `i/policies list`, `show`, `disable`.
- **HCI verifiers** (py) — 65 verifiers in `tools/HME/scripts/verify_coherence/`. Fires every pipeline run + on-demand. Inspect via `i/hme-admin action=selftest` (subtag column reveals "what kind of broken").
- **ESLint rules** — `scripts/eslint-rules/`. Fires `npm run main` lint phase. Inspect via `npm run lint`.

When something blocks you: bash hook (exit 2 + message), JS policy (`{decision: 'deny', reason: ...}`), HCI verifier (FAIL line in selftest), ESLint rule (lint output). Each has a unique signature.

## The verifier sub-tags

Every verifier carries a `subtag` declaring what *kind* of breakage it catches. The set:

- **structural-integrity** — would something stop loading/running? syntax, registration, decorator order, missing required structure.
- **interface-contract** — does the boundary still match? settings shape, subagent passthrough, schema, ownership.
- **drift-detection** — does the doc still match the code? numeric counts, doc-sync, memetic drift.
- **regression-prevention** — would this re-open a known failure mode? lifesaver integrity, silent failure, char spam.
- **performance** — is it slow / big / chatty? log size, hook latency, tool response time.
- **freshness** — has it gone stale?

When a verifier reds, the subtag tells you the shape of the fix before you read the message. For the live distribution at any moment: `python3 tools/HME/scripts/verify-coherence.py --json | jq '.verifiers | map(.subtag) | group_by(.) | map({tag: .[0], count: length})'`.

## The HME loop (per round)

1. `i/evolve focus=design` — pick a target module.
2. `Edit` — KB briefing auto-chains via `pretooluse_edit`.
3. `i/review mode=forget` — audit changes against KB; must be clean.
4. `Bash: npm run main` — pipeline (run_in_background=true).
5. STABLE | EVOLVED — `posttooluse_bash` auto-writes a KB draft to `tmp/hme-learn-draft.json`.
6. `i/learn action=accept_draft` — consume the draft (one tool call).
7. `round_complete` event fires — activity window closes, metrics rebase.

Steps 1-4 are agent decisions. Step 5 is automatic. Step 6 is one call. Step 7 fires from the stop hook. The whole arc converts "I did stuff" into "the KB knows what I did" with minimal ceremony.

## Where to look when you lose your place

- **"Where is HME across every dimension at once?"** → `i/holograph` (interstellar overview — one row per horizon, all 10 in ~12 lines)
- **"Where am I in the workflow?"** → `i/state`
- **"What just happened? what has HME done in the last N minutes?"** → `i/timeline` (joins markers + activity log into one chronological view)
- **"What's HME's current health?"** → `i/hme-admin action=selftest`
- **"Did my last edit help or hurt the score?"** → `i/status mode=hci-diff`
- **"What kind of broken is everything that's red?"** → `i/status mode=hci-by-subtag` (aggregates by category)
- **"How is the agent loop running this session?"** → `i/status mode=agent-loop` (Horizon IV — tools-per-turn, brief coverage, error rate)
- **"What does ground truth say about the chaordic band?"** → `i/status mode=band-tuning` (Horizon IX — proposes band bounds from human verdicts)
- **"How do music-coherence and self-coherence relate?"** → `i/status mode=conjugate` (Horizon V — joint distribution + quadrant classification)
- **"Which verifiers are dead weight?"** → `i/why mode=verifier-utility` (always-PASS / flapping / variance buckets)
- **"Which dirs are under-covered by verifiers?"** → `i/why mode=verifier-coverage`
- **"Which verifiers' status hasn't changed in N runs?"** → `i/why mode=verifier-drift` (Horizon VI third leg)
- **"Which axis is over/under-coherent?"** → `i/status mode=multi-axis-band` (Horizon II — per-subtag bands)
- **"How is the KB structured? Are entries woven together or flat?"** → `i/why mode=kb-graph` (Horizon III — citation/supersession edges + orphan map)
- **"What's the context around this KB entry?"** → `i/why mode=kb-context <id>` (per-entry traversal: outgoing/incoming edges + same-category siblings)
- **"What KB entries should I cite when adding a new one?"** → `i/learn action=suggest_predecessors title=… content=…` (Horizon III asymptote — semantic similarity → copy-paste-ready `tags=derived_from:<id>` suggestions)
- **"What verifiers might flip if I edit this file?"** → `i/why mode=predict <file>` (Horizon I — historical edit→flip correlation; per-FILE first, then per-dir fallback)
- **"How healthy is my agent loop right now?"** → `i/state` reads the GREEN/YELLOW/RED tier from `tmp/hme-agent-loop-tier.json` (Horizon IV maturity)
- **"Which verifiers should be down-weighted as dead-weight?"** → `tmp/hme-verifier-prune.json` lists always-PASS-for-≥10-runs candidates with `weight_multiplier: 0.5` (Horizon VI maturity; advisory)
- **"What will my next call probably cost?"** → `i/status mode=tool-latency` (Horizon I — per-tool p50/p95/p99 from recent invocations)
- **"What does the user's verdict history say about good moves?"** → `i/why mode=conscience` (Horizon VIII — approved/rejected move signatures from ground-truth log)
- **"What just happened that caused this event?"** → `i/why mode=causality <event>` (Horizon VII — heuristic causal-chain reconstruction from session adjacency)
- **"Walk the cause-of-cause chain back to root"** → `i/why mode=causality <event> --chain` (recursive walker; resolves caused_by → upstream event via prefix heuristics)
- **"What was the ROOT cause of this event?"** → `i/why mode=causality <event> --root-cause` (shorthand: walks to leaf silently, reports just the root)
- **"Did the conjugate-channel verifier change anything in the next pipeline run?"** → check `output/metrics/hme-coherence-budget.json` → `band_tightening` field. The V→IX coupling lands here; reflects whether the tightening proposal was applied, ignored as stale, or absent.
- **"How does the system respond to listener verdicts?"** → Consecutive `legendary` ground-truth verdicts trigger streak-aware band-loosening: each round of legendary streak adds +0.025 to the band-widen delta (cap +0.10) and +1 to the license duration (cap 4 rounds). The `tmp/hme-band-tightening.json` carries a `streak: {legendary_consecutive, policy}` field documenting which streak count produced the current proposal. Non-legendary verdict breaks the streak; license shrinks to base on next conjugate-channel run. **Real-time path:** even when `conjugate-channel` SKIPs (latest round has null `hme_coherence`), it still refreshes the license file based on streak alone (`trigger: streak-aware-skip-refresh`) — listener feedback updates composition licensing immediately, not gated on the post-composition correlation cycle.
- **"Does the architecture's tensegrity claim hold across scales?"** → `i/why mode=fractal-shape` (Horizon X — Gini fan-out at every scale)
- **"What in the KB knows about X?"** → `i/learn query="X"`
- **"What blocked me just now?"** → `i/why mode=block`
- **"Why is HME in this onboarding state?"** → `i/why mode=state`
- **"Why is verifier X red? what does it actually check?"** → `i/why mode=verifier <name>` (status + last 3 runs + source)
- **"Did HCI just regress? what caused it?"** → `i/why mode=hci-drop` (peak vs current + which verifiers flipped)
- **"What hooks have been firing recently?"** → `i/why mode=hook` (broader than mode=block)
- **"<free-text question> ?"** → `i/why "<question>"` (Tier-2: grep + KB + activity → citation packet, no LLM in the loop). Add `--deep` for Tier-3 subagent synthesis on top of the same packet.
- **"What does invariant Y mean?"** → `i/why <invariant-id>`
- **"What policy fired and how do I opt out?"** → `i/policies list`, `i/policies disable <name>`

## The single load-bearing principle

**Every stale string is a tax on every future agent.** Fix-hints, primer examples, error messages, doc references — all converge through one source of truth (`tools/HME/config/tool-invocations.json` + `tool_invocations.py` helper) so a rename touches one file. The numeric-drift verifier, doc-sync verifier, events-doc-sync verifier, character-spam verifier, repeated-char-spam policy all exist to keep this property: *the docs you read can be trusted to match the code that runs.*

This is what self-coherence means at the smallest scale. The HCI is just the same property scaled up: a 64-dimensional check that the system's self-description matches its self.

## Reference

- [CLAUDE.md](../CLAUDE.md) — rules (loaded every prompt; authoritative)
- [doc/AGENT_PRIMER.md](AGENT_PRIMER.md) — first-session walkthrough behavior
- [doc/HME.md](HME.md) — full HME reference (tool surface, Phase 1-6 internals)
- [doc/HME_SELF_COHERENCE.md](HME_SELF_COHERENCE.md) — why HME exists; the long view
- [doc/HME_HORIZONS.md](HME_HORIZONS.md) — the 10 architectural horizons HME hasn't yet stretched into; read when next-round work feels like rearranging stones
- [doc/HME_ONBOARDING_FLOW.md](HME_ONBOARDING_FLOW.md) — onboarding state machine spec
- [doc/LIFESAVER.md](LIFESAVER.md) — every hook/policy/verifier catalogued
- [tools/HME/activity/EVENTS.md](../tools/HME/activity/EVENTS.md) — every activity event documented
