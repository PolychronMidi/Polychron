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

### Todo - Set 47

#15 0_ F1 deeper policy/governance integration: wire the mesh into permission decisions, write gates, state ownership, and lifecycle hooks so every autonomous action is governable and auditable. AUDITABILITY HALF SHIPPED: teams/rounds/coverage_status.py turns doc/myth0s-coverage-map.md into a machine-readable governance signal (reviewed/pending counts + which control-plane surfaces lack mesh review; --strict gate; coverage_status.test.py 3 tests). ENFORCEMENT HALF NEEDS EXPLICIT CONFIRMATION (3_): making the live permission/write/lifecycle gates CONSULT review status to gate autonomous actions is a high-risk control-plane change -- needs a design decision (which surfaces gate which actions, fail-open vs fail-closed, override path) and CEO/user sign-off before implementation.
#16 5_ audit deep Phase Omega/autocommit spiral history far beyond 40 commits for accidental broad changes, weak tests, runtime artifacts, stale docs, and fake-green risk; found and isolated TodoMergeHookConsistencyVerifier fake-green risk as #26; ASCII/syntax/battery smoke clean
#17 5_ rerun full Python suite with a bounded foreground-safe runner that prints only counts and fails nonzero on any Python spec failure (PY_FILES=50 PY_FAILS=0)
#18 1_ prove read-chain through actual host/Claude Code transcript path, not only proxy HTTP: task-notification must lead to native Read tool_use/tool_result rows with hme_read_chain__ provenance
#19 0_ add negative-control tests for Phase Omega validators: coherence proof missing causal_path_ids, causal paths with readq restored, artifact lifecycle unclassified tracked path, failure alchemy forbidden labels
#20 0_ tighten artifact lifecycle lattice: distinguish vendored tools from first-party source, generated locks from hand-written source, runtime allowlist from metrics/proof fixtures, and require schema/freshness for tracked metrics
#21 0_ make final coherence traces hash-backed and validate with check_coherence_proof.py --verify-hashes
#22 0_ retire or mark historical stale consult proof language: nonce provenance, claude-print driver, PTY proof, and proof-pending wording outside explicit fixtures
#23 0_ update plan.md with Phase Omega shipped subset, exact artifacts, and remaining refinement suggestions
#24 0_ expand invariant topology coverage beyond seed nodes with coverage threshold for env failfast, source-grep bijection, artifact lifecycle, runtime freshness, and failure alchemy
#25 0_ add autocommit-error freshness check distinguishing current blocking errors from historical alert text using timestamps/freshness windows
#26 0_ audit and either restore or explicitly retire the missing TodoMergeHookConsistencyVerifier that was removed from tool_surface.test.py during the repair spiral; avoid fake-green by proving equivalent coverage exists
#27 0_ add a guard or workflow check for repeated forbidden /hme/spawn attempts after the first block; the agent loop repeatedly retried the same denied route while claiming it was switching to direct Bash
