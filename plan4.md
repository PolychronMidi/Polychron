# Polychron / HME Evolution Plan #4 — for review

**Status: PROPOSAL. No implementation until cleared by user.**
Scope: HME substrate only. LOAD-BEARING target — silent failure degrades real
runtime behavior (every outbound inference request). Same lens as prior plans:
declared-vs-actual divergence.

Produced by Agent1 ↔ Agent2 (`chat.md`, max-effort). Claims verified against
source; line refs real.

---

## Target — No outbound context-budget gate before sending upstream

**Symptom (real, in `log/hme-errors.log`):** repeated
`UPSTREAM_200_INTERACTIVE: "Your input exceeds the context window of this model"`
and `UPSTREAM_502 stream_early_eof`, firing even when the human-visible chat is
nowhere near a context limit. These are NOT "your conversation is too long" —
they are the proxy shipping an over-window *outbound payload* and the provider
rejecting it opaquely.

**Evidence:** the saved failing request snapshots
`tmp/claude-*-interactive-payload-*.json` are enormous — one is ~336k tokens by
the editor's own count. The over-window mass is hidden payload (tool schemas,
system blocks, tool-result history, injected context), not user text.

**The divergence (verified in source):**
- `hme_proxy_request_mutation.js` compacts the interactive payload EARLY
  (`compactLargeInteractiveAnthropicPayload` + `applyExplicitOtpmCap`, lines
  257-263), then RE-INFLATES it: `injectHmeTools` (293), middleware pipeline
  (309), stop-reminder/status/jurisdiction injections (315-341), cache-control
  normalization (342).
- Early compaction sizes against a **static byte threshold**
  (`_anthropicTransportMaxBytes` ← `HME_PROXY_INTERACTIVE_MAX_BYTES`), NOT the
  resolved route's context window. `applyExplicitOtpmCap` caps **output**
  tokens, not input. `_modelOutputInfo()` already computes `maxInput`/`context`
  but feeds them only to `_dynamicOutputCap` — never to an inbound gate.
- OmniRoute model swap (`hme_proxy_claude.js:144`, `_swapModel`) can pick a
  smaller-context target than the input was sized for: a payload that fit
  Claude's 200k no longer fits the swap target.
- **There is NO final budget check after all mutations and before the single
  upstream write (`hme_proxy_claude.js:332`).** Shrink → re-bloat → ship.

**Runtime consequence:** live requests fail upstream with opaque context-window
or early-EOF errors; HME's autocommit/lifesaver loop then thrashes on the
fallout. The proxy never compacts-again / reroutes / fails locally with an
actionable reason.

---

## Proposed fix (load-bearing, single invariant)
A **final outbound context-budget gate** is the right fix because it holds
regardless of *why* the payload is over-window (swap to smaller context,
re-inflation, or genuinely large input all collapse to one check). Fixing swap
selection alone leaves re-inflation unguarded; fixing re-inflation alone leaves
swap mismatch. Swap-awareness becomes just "feed the same budget number," not a
separate fix.

**Placement (unbypassable):** in `hme_proxy_claude.js` immediately after
`outBody = mutation.outBody` (line 181) and before `_spawnUpstream()` writes the
wire (332) — the one point where every mutation has run AND the resolved route
(`_swapModel`/`_omniProvider`) is known. Keyed to
`_modelOutputInfo(_swapModel || payload.model).context` (or `maxInput`). Putting
it inside `mutateClaudeRequest` is too early — it can't see the swap decision,
and a later handler-level mutation could still re-dirty `outBody`.

**Tiered gate behavior:**
1. Estimate final `outBody` tokens (`semanticTokenEstimate`) vs route context.
2. Over budget → compact again to fit (reuse existing compaction).
3. Still over → reroute to a larger-context route in the swap chain.
4. Still over → fail LOCALLY with `UPSTREAM_PREFLIGHT_OVER_WINDOW`, naming
   est-tokens vs route-limit. Never ship a known-over-window request and let the
   provider emit an opaque `stream_early_eof`.

**Proof (same negative-test discipline as plans 1-3):** feed a real ~336k saved
snapshot through the mutation path with an OmniRoute swap target and assert:
(a) WITHOUT the gate, final `outBody` tokens exceed the route `context`
(reproduces the 200/502); (b) WITH the gate, final tokens ≤ context OR the local
preflight failure fired. Add it as a permanent regression fixture so the gate is
provably able to FAIL.

**Blast radius:** one gate function + wiring at a single call site + one
regression test. No change to compaction internals or routing logic beyond
feeding them the budget number.

## Open questions for you
1. Tier order: prefer **reroute-to-larger-context** before **compact-again**, or
   compact first (cheaper, preserves the chosen model) then reroute? I lean
   compact-first, reroute-second, local-fail-last.
2. On local fail (tier 4): hard-fail the request with the actionable reason, or
   emit a degraded best-effort compaction and warn? (Prior "no warnings"
   directive suggests hard-fail.)
3. Budget basis: gate on `context` (full window) minus the output cap, or on
   `maxInput` directly where models.json declares it?
