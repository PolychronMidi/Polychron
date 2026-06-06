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

### Todo - Set 24

#1 5_ A1 myth0s claim-audit addendum: capsule template + reviewer-charter structured finding record (claim/artifact+fn/failure-mode/precondition/supporting-evidence/contradictory-evidence/one-line-fix/severity/confidence); high-impact capsules only, routine reviews stay lightweight

#2 5_ A2 contradictory-evidence requirement in reviewer charter: every claimed defect must cite >=1 existing guard/test/code-path that might already cover it and say why it does/doesnt (false-positive reducer)

#3 5_ A3 audit-thoroughness score separate from severity: source-read-only / source+adjacent-tests-config / source+runtime-repro-or-invariant -- so plausible P1 is distinguished from proven P1

#4 5_ A4 decision-impact weight per finding (load-bearing/substantive/peripheral) to focus peer budget; per cost-control charter, never used to suppress legitimate deep work

#5 5_ A5 anti-inflation severity calibration with safety caveat: default to lower severity when uncertain UNLESS executable evidence or fail-open safety consequence (then fail closed)

#6 5_ A6 finding-death framing in charter: a peer reporting 'no decision-changing issue found, with evidence' has SUCCEEDED (clean audit is a win, not a gap to fill)

#7 5_ A7 cross-role disagreement as uncertainty signal: red/blue/purple divergence beyond one severity tier on high-impact arch/security claims emits an explicit 'audit-uncertain: recommend human review' artifact

#8 1_ B1 broaden mesh coverage: run fork/full-tool capsule-grounded rounds on fresh load-bearing surfaces (pre-write gates, state registry, stop-chain policy, session-state lifecycle, transcript compaction, proxy request mutation, tool-result semantics)

#9 5_ B2 build reviewed coverage map of every place an agent can mutate state, consume context, or enforce policy, so coverage is tracked not ad hoc -- DONE: doc/myth0s-coverage-map.md (policy-enforcement / state-mutation / context-consumption surfaces with review status), parsed by teams/rounds/select_target.py

#10 5_ C1 formal evaluation harness: repeatable baseline-vs-mesh benchmark scored on unique catches, false-positive reduction, time/cost, and regression impact -- DONE: teams/rounds/score_round.py (severity counts, reply-byte cost proxy, calibration-signal counts, unique-in-mesh heuristic) + score_round.test.py (3 tests); demonstrated on real pre-write round (baseline 6 findings vs mesh 25, unique_in_mesh 8)

#11 5_ C2 treat the A1-A7 calibration layer as a measurable variable in the benchmark (does calibration cut false positives without hiding real catches) -- DONE: teams/rounds/eval_harness.sh runs the round CLAIM_AUDIT=0 vs =1 and score_round.compare() diffs the two scorecards (calibration-signal delta + severity delta + unique-catch delta); covered by score_round.test.py compare test

#12 5_ D1 cost control (charter-bound): smarter target selection + capsule-evidence caching that reduces redundant re-derivation, never truncates legitimate exploration -- DONE: teams/rounds/capsule_cache.py (memoize capsule coverage<->evidence validation by content hash; edits invalidate; caches ONLY static validation, never peer exploration) + teams/rounds/select_target.py (next pending surface from the B2 map) + capsule_cache_select.test.py (3 tests); dogfooding the CLI caught + fixed a --all arg-parse bug

#13 0_ D2 cost control (charter-bound): adaptive effort + per-finding cost telemetry with explicit headroom so reasonable depth and necessary multi-turn peer dialogue are never cut short; telemetry observes, never caps legit depth

#14 0_ E1 productize Context Capsules: tooling to generate/lint/diff/archive capsules (coverage<->evidence consistency check as a reusable linter) with the claim-audit addendum as optional high-impact mode

#15 0_ F1 deeper policy/governance integration: wire the mesh into permission decisions, write gates, state ownership, and lifecycle hooks so every autonomous action is governable and auditable

#16 0_ G1 internal supervised pilot of myth0s on selected engineering surfaces; success = measurable unique defect discovery, low false-positive burden, stable cost envelope, calibrated dissent surfaced, zero policy-bypass regressions

#17 0_ B1-followup pre_write_check.js deeper hardening (mesh-found, deferred to avoid derailing): (a) move the hard-deny checks OUTSIDE the fail-open policy/_loadPolicies try so a policy-framework throw cannot skip shell-parity/edit-current/kb hard checks; (b) re-validate policy rewrites against the early shape/todo/patch hard gates (a rewrite of file_path/old_string/content currently bypasses them); (c) add a stateClient-injection regression test proving a state-write outage on a deny path still returns deny. Applied already in place: _advisoryWrite (state outage can no longer convert a computed deny to allow) + policy-error ask deferred until after hard checks

#18 0_ B1-followup state_registry.js (mesh-found, deferred): (a) append() bypasses _writeAtomic -- give jsonl/text append crash/concurrency safety (lock + fd append + fsync, or route through read+atomic-write) [P1 med-high]; (b) read() JSONL .filter(Boolean) drops valid falsy scalars (false/0/""/null) -- use a parse sentinel and filter only parse failures [P2, no current caller contract for scalar jsonl]; (c) write() jsonl branch preflight Array.isArray + pre-serialize before touching disk [P2 hardening]. Applied already in place: schema now gates READS not only writes (corrupt/legacy json returns null) + _writeAtomic fsyncs temp fd and parent dir (crash-durable)

#19 0_ B1-followup stop_chain/index.js AUDIT-UNCERTAIN items (mesh flagged for human review, need provenance/fixture audit): (a) _hme_subagent escape -- verify whether a Stop payload's _hme_subagent can be attacker/host-set (provenance audit); if untrusted, gate it; (b) _isCascadeBreakConditions Case 2 (lastUserIdx > lastAssistantIdx short-circuits all policies) -- build transcript fixtures proving it only fires on a genuine intended-stop deny loop, not a reachable bypass. Applied already in place: 3 confirmed P1s (mandatory config-disable bypass fails closed; throwing enable-check keeps mandatory enforced; telemetry t.error throw no longer wedges mandatory deny) + bounded transcript read (CASCADE_READ_CAP tail) with 2 regression tests
