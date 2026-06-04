# Plan

Reviewed proposals for HME work. Agent1 (orchestrator) + Agent2 (peer, forked
session) confer in chat.md; durable, user-approvable proposals land here. Nothing
in this file is implemented until the user marks it approved.

## Status legend
- proposed: drafted from Agent1/Agent2 conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## History
- Phase 1 (P1-P5, archived 2026-06-04): stale-proof completion claims read as debt
  (P1) + the P5 laundering-hole fix, one-shot UPS p95 bench (P2), causal braid
  auto-populated by resolvers (P3); P4 (field-widen) declined. All verified, Agent2
  confirmed "phase done." Durable record in TODO #15 / git history.

## Proposals (Phase 2 -- fresh conferral, awaiting human approve/deny)

### P1 -- Policy dead-weight surfacing  [done]  (rank 1)
- intent: surface builtin policies with 0 fires over a recorded hook-decision window as REVIEW candidates -- unambiguous dead weight, no TP/FP discriminator needed.
- seam: `event_kernel/hook_decision_log.js` (record the firing policy name on DENY rows, parity with the existing policy_rewrite `policies[]`), `scripts/why-coherence.js` runDebt() (diff registry.list() vs policy-names-seen-in-window -> 0-fire list). Fold into mode=debt, NO new mode.
- net coherence: makes policy genome + decision-log counts load-bearing for PRUNING; directly attacks the project's prime enemy (dead weight / context cost) with unambiguous data, not a guessed verdict.
- bounded cost: low; one log field + one diff in an existing view. Frame as "0-fire over window, REVIEW," not "retire."
- NOT this: no confident ceremony/noise/retire verdict (no TP/FP discriminator = the #14a trap); no auto-disable; no new i/why mode; "0-fire != dead" for rare critical guards (block-runlock-deletion fires ~never but is load-bearing) -> human reviews, never auto-prune.

### P2 -- Immune classify -> metabolize  [done]  (rank 2)
- intent: recurring noise the immune classifier already detects becomes DURABLE memory -- classify -> append to the existing context_metabolism ledger -> surfaced by existing mode=debt/metabolize. Honors "silently metabolize unless action required."
- seam: `activity/universal_pulse_tick.py` (background daemon, OFF the hot path) reads the recent error lines it already accesses, calls `immuneResponse`, appends recurring-classified patterns (dedup by pattern key) to context_metabolism; the existing metabolism pass composts low-score and promotes recurring to durable.
- net coherence: completes the immune loop (detect -> classify -> metabolize -> memory); today it stops at classify. Wires two organs (immune + metabolism) load-bearing together with 0 new surface.
- bounded cost: low; reuses the universal_pulse scan (no new daemon/pass) + the existing ledger. Dedup + compost keep it from spamming.
- NOT this: no auto-suppress/quarantine in the live path (wedge risk, dup of crying_wolf/lifesaver) -- classifier stays advisory; the ONLY action is metabolize->memory (writes the ledger, gates nothing); NOT on UserPromptSubmit (would worsen the p95 we just chased).

### Skips (named, not padded)
- Coherence-field consumer (P4 unblock): SKIP -- still no trustworthy consumer; the vector inputs are heuristic (intent_alignment guessed from presence of a string), so any "turn coherence score" misleads. Same P4 problem; wait for real signal-bearing inputs.
- UPS p95 live attribution: SKIP -- not a code task. ups-step-timing.jsonl accumulates live per-step; ups_timing.py self-attributes once samples exist. No code lever -> don't invent one.

### P3 -- Phase-2 telemetry-honesty fix (Agent2 post-impl review)  [done]
- Flag 1 (FIX): `why-coherence` dead-weight line now carries a coverage caveat -- "seen" = denied/rewrote via the unified path; a 0-fire builtin that only INSTRUCTs or fires via shell/native may still be live; human confirms before retiring. (No unsound "no other fire path" test assertion.)
- Flag 2: confirmed fine, no change (rewrite-class counted on rewrite, deny-class on deny; allow-only = genuinely not firing).
- Flag 3 (FIX, real bug): immune_metabolize was dedup-SKIP = "one fact per class FOREVER" -> showed FIXED classes forever and ignored re-intensification (the immune organ creating the exact stale noise it exists to kill). Now dedup-UPSERT: a still-recurring class is refreshed (recency=1, current count); a no-longer-recurring class decays its recency each pass and drops out once faded -- immune memory tracks CURRENT recurrence, not first-seen. Added `context_metabolism.writeFacts` (owner-side atomic replace) for the reconcile.
- pins: P1 recordPolicyDeny -> dead-weight diff (policies[] key drift = false 0-fire); P2 refresh + decay-out (coherence_substrate asserts a fixed class leaves memory). coherence_substrate 26/26, claim_proof+stop_chain 20/20, ownership 41/41.

## Watch-items (named, deferred -- do NOT pre-build)
- `context_metabolism.writeFacts` lost-update: the immune reconcile does a full read-modify-replace that is NOT flock-guarded vs a concurrent `appendFact` (incident fanout, different process). Atomic-rename prevents a torn file but not last-writer-wins, so a rare overlap could drop one freshly-appended non-immune fact. Severity LOW: advisory ledger (feeds mode=debt durable surfacing, gates nothing); the lost copy is the least load-bearing (incidents also live in incidents.jsonl + coherence_events + hme-errors.log); frequency negligible (immune throttled >=600s, incidents rare). TRIGGER to fix (flock read-modify-write, mirroring the todo-engine pattern): only if context_metabolism gains a concurrent HIGH-FREQUENCY writer. Today none exists -> building a lock now is premature speculative hardening.

## Decision
Phase 2 DONE (Agent2 confirmed "phase done"). P1 policy dead-weight surfacing + P2 immune classify->metabolize + P3 honesty fix (Flag 1 caveat, Flag 3 upsert/decay-out): both organs load-bearing + self-honest, telemetry-only, off the hot path. Evidence: coherence_substrate 26/26, regression 20/20+36/36, ownership 41/41, live mode=debt renders the caveat + immune_memory. Skips held (P4 field-widen, UPS p95 live attribution). One named watch-item (writeFacts lost-update) deferred with an explicit flock trigger. Durable record in TODO #16.
