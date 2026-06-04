# File Format Rules: 1 todo item per line. Each line must start with one of the following todo status codes:
0_ default status upon creation,
1_ in progress,
2_ revisit (default is in 10 minutes, or whenever all todos in list completed, move to top of list as status 0_). Specify minutes by appending like "2_60",
3_ major block via architechtural design, scope, or low confidence/high risk needing explicit confirmation,
4_ nominally complete, but needs a follow-up. Must be followed by the follow-up todo on the next line with the following code,
4f_ follow up todo, automatically becomes status 0_ in 30 minutes, or specify custom minutes like "4f_60" for 60 minutes. If needs qualifier before becoming status 0_, append _q="qualifier explanation here". Auto-added to new todo sets
5_ Completed totally, no danglers, nothing missing.

Example:
#1 5_ make todo template with rules so agents can simply fill out below. A set auto-archives to `log/todo/set<number>.md` once no item is still in progress (none at 0_/1_/2_) and at least one item is 5_; the non-5_ items (3_/4_/4f_) carry forward into the next set with their codes preserved

### Todo - Set 16

#13 4_ self-coherence substrate (typed coherence-event ledger + failure ontology): incident_registry fans out to coherence_events + context_metabolism facts; incident_resolvers prove upstream-context-window/stale-runtime/autocommit/observation classes resolved so LIFESAVER ghosts suppress only after proof; claim_proof stop policy wired live (strict = hard-deny on absolute-completion-claim+edits+no-verification, non-strict = shadow instruct + verdict event), non-mandatory + fail-open so it cannot wedge the chain; context_metabolism.runMetabolismPass composts low-score facts and surfaces durable invariants; invariant_mesh + tests gate every tool_result-mutating middleware's idempotency declaration and every state-file owner; self_origin.js is the single classifier with a drift-guard vs _self_tags.sh / 22_lifesaver_inject; i/why mode=proof|debt|mesh|resolve|metabolize; one bounded coherence event per Stop run; drift threshold 0.18→0.25; replaced the non-canonical root todo.md; full HME suite green [E3]

#14 4f_ self-coherence substrate follow-ups: (a) RESOLVED -- decided DO NOT flip claim_proof from shadow to hard-deny in NON-strict mode. Inspected the accumulated ledger: 90 claim_proof events, only 3 deny-class (and 2 of those 11s apart = the same turn retried after the shadow instruct, so ~2 distinct turns in 90). The qualifier ("denials would be signal, not noise") could NOT be met because the ledger recorded only {decision, shadow, claim_class} -- no TP/FP discriminator -- so the 3 denies cannot be proven real catches vs false alarms. Hard-deny in the common (non-strict) mode would trade a real wedge-risk on any false positive for a ~2/90 catch; strict mode already hard-denies for operators who want it, and the shadow + i/why visibility is the correct fail-open default. ROOT-CAUSE FIX so the next batch IS decidable: instrumented the verdict event (claim_proof.js _emitVerdict now records edits + verified -- a deny with verified=false is a genuine unverified-claim catch=signal, verified=true is a likely false alarm=noise) and surfaced a `policy_feedback claim_proof_shadow: action=... signal=... noise=...` line in `i/why mode=debt` via the existing coherence_economics.policyFeedback pattern. Flip only when that line shows action=keep with signal>0. Evidence: claim_proof_stop_policy + why_modes + stop_chain + coherence_substrate 45/45 green, mode=debt emits the line, comment-bloat/lint clean. (b) STILL OPEN: deferred UserPromptSubmit p95~1100ms live per-step instrumentation -- hook is ~170ms in isolation so the p95 is load/env-driven, needs production timing not a code edit _q="UserPromptSubmit production per-step timing shows where the ~1100ms p95 goes"

#15 5_ HME design-pattern cleanup: strengthened `event_kernel/decision.js` with canonical TYPES/kind helpers so policy code stays on allow/deny/instruct/rewrite/error decisions, not host hook JSON

#16 5_ HME design-pattern cleanup: added `event_kernel/decision_renderer.js` as the single policy-result renderer for hookSpecificOutput and event-name ownership

#17 5_ HME design-pattern cleanup: refactored dispatcher unified-policy handling through the canonical reducer/renderer, including PermissionRequest rendering as PermissionRequest while reusing the PreToolUse policy context

#18 5_ HME design-pattern cleanup: added regression coverage for deny/rewrite/instruct rendering, PermissionRequest hookEventName ownership, silent automatic rewrite notes, and comment-bloat message expectations
