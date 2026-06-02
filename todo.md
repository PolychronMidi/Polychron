# HME self-coherence TODO

## Phase: typed coherence substrate

- [x] Coherence event ledger: every policy/tool/test/claim/failure can emit a compact event with kind, subject, intent, evidence, coherence delta, entropy delta, obligations, and expiry.
- [x] Proof-carrying context: classify claims as observed, executed, derived, hypothesis, policy, or stale; block/soften unsupported completion claims.
- [x] Context metabolism: raw trace -> extracted facts -> verified facts -> durable invariants -> compact doctrine -> obsolete facts composted.
- [x] Coherence budgets: track token, latency, false-positive, false-negative, user-attention, hook-noise, test-runtime, branch, and stale-state costs.
- [x] Invariant mesh: graph services, state files, middleware, routes, decisions, tests, incidents, and resolvers.
- [x] Failure ontology: typed incidents with status, root cause, fixed_by, regression_test, resolver, and proof; suppress LIFESAVER ghosts only after proof.
- [x] Agent immune system: detect readless edits, unsupported done claims, workaround ceremony, context stuffing, and hypothesis-free debugging.
- [x] Self-healing policies: measure whether each deny/rewrite/instruct prevented a real failure or created noise; narrow or retire weak policies.
- [x] Coherence-aware tests: resolvers exist for targeted LIFESAVER classes (upstream context-window, stale-runtime, observation/self, autocommit) and unhandled classes fail-safe to surfacing; mesh test enforces every mutating middleware declares an idempotency marker and every state file has an owner.
- [x] Multi-scale review: subtoken/provenance, function contracts, module boundaries, middleware lifecycle, request path, runtime ecology, portability.

## Wiring (substrate is load-bearing, not inert)

- [x] Producer: `incident_registry.recordIncident` fans out to a coherence event + a context-metabolism fact (best-effort, never breaks the incident path).
- [x] Producer: `incident_registry.resolveIncident` is idempotent and is driven by `i/why mode=resolve` for resolver-proven error lines.
- [x] Consumer: `i/why mode=proof` runs `claim_proof_guard` over the live ledger (blocks the "all incidents resolved" claim while any are unresolved).
- [x] Consumer: `i/why mode=debt` emits a `coherence_economics` policy-feedback signal from real ledger events.
- [x] Dedupe: self-origin/observation classification sourced from one `self_origin.js` instead of a third hand-maintained copy.
- [ ] Deferred (deliberate, risky hot-path): run `claim_proof_guard` as a live blocker in the Stop chain. Left as a query-surface + library until scoped, to avoid destabilizing the request path.

## Concrete implementation backlog

- [x] Add `coherence_events` state file + schema + append helper.
- [x] Add typed incident registry with resolver registry and `resolved` proof rows.
- [x] Add resolvers for upstream context-window escapes and stale-runtime/proxy-liveness ghosts.
- [x] Add `i/why mode=proof`, `i/why mode=debt`, and `i/why mode=mesh` query commands.
- [x] Add context metabolism module for facts, decay, contradiction pointers, and compacted doctrine candidates.
- [x] Add claim proof guard for completion/fixed/all-done language against same-turn evidence.
- [x] Add invariant mesh builder tying dispatcher routes, middleware manifest, state-files, service registry, tests, and incidents.
- [x] Add tests proving typed incidents, resolver suppression, event ledger appends, mesh queries, metabolism decay, and proof guard behavior.
