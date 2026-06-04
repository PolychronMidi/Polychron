# Plan

Driver (orchestrator) + peers confer; durable, user-approvable proposals land
here. Nothing in this file is implemented until the user marks it approved.

## Status legend
- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## History
- Phase 1 (archived 2026-06-04): stale-proof completion claims read as debt + the
  P5 laundering-hole fix, one-shot UPS p95 bench, resolver-filled causal braid;
  field-widen declined. Agent2 confirmed phase done. (TODO #15.)
- Phase 2 (archived 2026-06-04): policy dead-weight surfacing + immune
  classify->metabolize + the Flag-1/3 honesty fix; both organs load-bearing +
  self-honest, telemetry-only, off the hot path. One named watch-item
  (context_metabolism.writeFacts lost-update -- flock only if a concurrent
  high-freq writer appears). Agent2 confirmed phase done. (TODO #16.)

## Watch-items (named, deferred -- do NOT pre-build)
- `context_metabolism.writeFacts` lost-update: not flock-guarded vs a concurrent
  appendFact; LOW severity (advisory ledger, copy-of-record elsewhere, negligible
  frequency). Add flock read-modify-write ONLY if a concurrent high-frequency
  writer appears. Today none -> a lock now is premature speculative hardening.

## Proposals (Phase 3 -- red/blue/purple team build-out, conferral in progress)
_(none yet)_
