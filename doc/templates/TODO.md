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

### Todo - Set 55
1_ Reopen falsely-completed Set 54 self-coherence substrate work: replace marker-only completion with substantive prod-wide implementation, evidence, and regression tests.
0_ Implement a real invalidator event stream for tracked_code_edit, verifier_edit, policy_edit, test_edit, kb_source_edit, pipeline_run, tool_response_defect, agent_launch, claim_superseded, evidence_secret_detected, and claim_storage_over_cap.
0_ Wire invalidator emission into actual edit/test/pipeline/tool/agent paths so `isCurrent(claim, invalidators)` no longer depends on hand-built test invalidators.
0_ Migrate all HME status, alert, score, warning, KB entry, pipeline verdict, tool-response surface, and subagent result surface to emit canonical coherence claims with freshness_proof, evidence_hash, repair, tests, and retirement_condition.
0_ Make the coherence claim gate universal: read runtime claim files, apply live invalidators, fail schema-invalid claims, stale-current claims, missing freshness proofs, missing repair paths, and leaky evidence.
0_ Wire the universal claim gate into HME precommit/main-pipeline/health paths so a stale-current or schema-invalid claim cannot be silently presented as current.
0_ Add `i/status`/substrate status surface for comment-bloat and all runtime claims showing current vs stale, generated_at, evidence_uri, evidence_hash, and repair.
0_ Populate tool-response quality ledger automatically from proxy/tool wrappers for contract violations, false success/failure/no-output, output bloat, stale state, policy bypass, schema violations, timeouts, and below-threshold ratings.
0_ Enforce tool-response waiver owner/reason/expiry/evidence/regression rules at consumption time, not only helper-test time.
0_ Feed tool-response quality aggregation into HCI-Tooling in live status/pipeline outputs.
0_ Enforce Agent fork-proof in the actual Agent PreToolUse launch path using live OmniRoute/session token telemetry, bounded prompt metadata, and emergency allowlist validation.
0_ Persist Agent launch audit rows and invalidate/reject launches with missing, stale, fresh-context, or low-ratio fork proof.
0_ Backfill KB semantic checksum metadata for real KB entries: source_files, symbols, tests, decision_date, supersession_condition, confidence, evidence_hash, source/symbol checksums.
0_ Wire KB stale detection to actual source/symbol edits so referenced KB entries become possibly stale without synthetic test invalidators.
0_ Populate the persistent claim graph with real file, verifier, policy, test, KB entry, alert, repair, claim, evidence, and invalidator nodes.
0_ Write producer/evidence/test/repair/invalidator claim-graph edges from real verifier, pipeline, alert, and repair paths.
0_ Make `i/why mode=claim <thing>` use the real populated claim graph to show rule origin, birthing bug, preserving tests, retirement condition, and breakage risk.
0_ Run verifier self-doubt audits across every verifier: intent fit, bypass blindness, false positive risk, false negative risk, actionability, fail-loud mode, and ceremony-gaming risk.
0_ Run meta-rule audits across every warning/rule/repair/regression/lineage: usefulness proof, death condition, repair regression, lineage purpose, and currentness proof.
0_ Enforce evidence and telemetry data-minimization before claim evidence capture: hashes/URIs/timestamps/bounded excerpts only, no raw prompts, raw requests, raw responses, secrets, or unbounded payloads.
0_ Add scheduled/runtime claim graph storage-cap and retention enforcement so the substrate cannot become context/storage bloat.
0_ Harden pipeline exit policy so diagnostic_verdict or self_coherence_verdict FAIL exits nonzero unless an explicit owner/reason/expiry/regression allowlist is active.
0_ Add regression fixtures proving STABLE plus diagnostic failure and STABLE plus self-coherence failure exit nonzero without allowlist and pass only with valid allowlist.
0_ Replace Set 54 archive's false `5_` completion with an accurate archive note or carried-forward status so TODO history does not claim prod-wide completion before proof.
0_ Run focused substrate tests, full HME suite, precommit validation, and `npm run main` after the reopened work is substantively implemented.
