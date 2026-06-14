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

### Todo - Set 54
1_ Inventory every HME status, alert, score, warning, KB entry, pipeline verdict, tool response surface, and subagent result surface that needs claim/currentness fields.
0_ Define canonical coherence claim schema at `tools/HME/schemas/coherence-claim.schema.json` with schema_version, claim_id, subject_uri, producer, status, severity, confidence, evidence_uri, evidence_hash, scope, invalidator_keys, generated_at, expires_at, repair, tests, retirement_condition, and supersedes.
0_ Add schema validation unit tests that reject malformed claims, missing freshness proof, missing repair path, and invalid status/severity values.
0_ Add claim writer helper that validates before writing and stores bounded evidence references rather than raw large payloads.
0_ Add claim reader helper that rejects stale schema versions and returns typed current/stale/invalid states.
0_ Add invalidator registry with normalized keys for tracked_code_edit, verifier_edit, policy_edit, test_edit, kb_source_edit, pipeline_run, tool_response_defect, and agent_launch.
0_ Add invalidator scope matcher that marks unknown relevant invalidators stale by default instead of current.
0_ Add `isCurrent(claim, invalidators)` helper with tests for current, stale, expired, superseded, and unknown-invalidated claims.
0_ Add CI/HME gate that fails on schema-invalid claims, stale-current claims, missing freshness proof, or missing repair path.
0_ Implement MVP vertical slice using comment-bloat: audit emits schema-valid claim with evidence hash and tracked-code invalidators.
0_ Add comment-bloat status surface that displays current vs stale claim state with generated_at and evidence_uri.
0_ Add test where touching a scoped JS file invalidates the comment-bloat claim until audit reruns.
0_ Add test where rerunning comment-bloat refreshes the stale claim to current.
0_ Add negative fixture for prose JS block comment failing at 5+ lines.
0_ Add negative fixture for long prose comment failing at 90+ chars.
0_ Add positive fixture proving JSDoc type metadata is exempt from prose-bloat classification.
0_ Add positive fixture proving generated comment blocks are exempt only with generated markers.
0_ Add stale-comment fixture where prose comment fails when claim graph shows referenced code drift.
0_ Migrate one HCI verifier to emit claim/evidence/freshness/repair/retirement fields.
0_ Split HCI output into HCI-Verifier, HCI-Behavior, HCI-Tooling, HCI-Temporal, and HCI-Composite.
0_ Add HCI phase field with maintenance, composition, audit, exploration, and repair phases.
0_ Add phase-aware HCI scoring so edit-heavy maintenance sessions do not look like composition incoherence.
0_ Split pipeline summary into behavioral_verdict, diagnostic_verdict, self_coherence_verdict, and exit_policy.
0_ Add pipeline negative fixture where STABLE plus diagnostic failure marks diagnostic verdict FAIL or exits nonzero.
0_ Add pipeline negative fixture where STABLE plus self-coherence failure marks self_coherence verdict FAIL or exits nonzero.
0_ Add allowlist structure for nonfatal pipeline steps with owner, reason, expiry, and regression test.
0_ Define tool-response rating taxonomy with contract violation classes, owner, reproduction, repair_status, waiver_expires_at, and regression link.
0_ Add tool-response ledger that records contract-violating and below-threshold responses without logging every minor 8/10 event.
0_ Add expiring waiver ledger for below-threshold tool responses with owner, reason, expiry, evidence, and regression link.
0_ Add HCI-Tooling aggregator that ingests tool-response ledger defects.
0_ Define OmniRoute/token telemetry source for parent/session context token counts and agent context token counts.
0_ Add fail-closed behavior when Agent fork-proof token telemetry is missing or stale.
0_ Add Agent fork-proof check using context-token ratio and bounded prompt metadata.
0_ Add test blocking nested Agent calls inside multi-tool wrappers.
0_ Add test blocking or rerouting subagent launch when fork-context ratio is below configured threshold.
0_ Add emergency Agent allowlist schema with owner, expiry, reason, and audit trail.
0_ Add KB semantic checksum fields for source files, symbols, tests, decision date, supersession condition, confidence, and evidence_hash.
0_ Add KB stale detection when referenced source files or symbols change.
0_ Add KB stale test where editing a referenced source symbol marks the KB entry possibly stale.
0_ Add claim graph storage/indexing for file, verifier, policy, test, KB entry, alert, and repair nodes.
0_ Add claim graph edge writer for producer/evidence/test/repair/invalidator relationships.
0_ Add `i/why mode=claim <thing>` explorer showing rule origin, birthing bug, preserving tests, retirement condition, and breakage risk.
0_ Add verifier self-doubt audit requiring each verifier to answer intent fit, bypass blindness, false positive risk, false negative risk, actionability, fail-loud mode, and ceremony-gaming risk.
0_ Add meta-rule audit proving every warning has usefulness proof, every rule has death condition, every repair has regression, every regression has lineage, and every lineage has purpose/currentness proof.
0_ Add evidence data-minimization rules for hashes, URIs, timestamps, bounded excerpts, and retention limits.
0_ Add telemetry data-minimization rules so token telemetry stores counts and route metadata, not raw request payloads.
0_ Add secret-redaction check before claim evidence capture.
0_ Add claim graph storage cap and retention policy to prevent the substrate becoming context/storage bloat.
0_ Add documentation for the self-coherence field substrate MVP, build sequence, and acceptance criteria.
0_ Run focused schema/currentness/comment-bloat/tool-ledger/agent-fork tests after initial implementation.
0_ Run HME selftest after claim substrate MVP lands.
0_ Run `npm run main` after pipeline verdict split and HCI changes are complete.
