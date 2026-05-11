# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)






<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->





- [easy] (d) Triage finding: the 17 frozen selftest probes are NOT dead-weight like the HCI-side prune candidates were. Probes like HCI, hash cache, KB, reload mechanism, local inference, arbiter, think history check infrastructure invariants that genuinely hold when the system is healthy -- PASS-for-50-runs reflects stable healthy state, not unreachable predicates. Distinction from HCI prune: those candidates were literally REMOVED from the codebase (always-PASS by absence of data emission); these probes still run and emit PASS/WARN/FAIL based on live state. The Horizon VI mitigation here is variance-source dynamism (probe a randomly-chosen subset each run) rather than blanket pruning. Documented in this SPEC; no probe changes made. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (a) `pretooluse_edit.sh` new block: refuses Edits whose new_string contains `except[^:\n]*:\s*\n[ \t]*pass\b` WITHOUT `# silent-ok:` annotation within 200-char window. Constitution rule 3's escape clause documented in the block message. Verified: naked except matches; `pass  # silent-ok: <reason>` allowed. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (b) Top-offender file swept: `tools/HME/scripts/buddy_handoff_consult.py` had 8 naked `except OSError: pass` blocks (best-effort filesystem ops). Annotated all 8 with `# silent-ok: best-effort fs op`. Post-sweep count: 0 naked remaining in file. Top-second offender (`scripts/hme/state-panel.py`, 4 sites) and others queued for future cycles; the gate now prevents new violations going forward. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (c) `/reindex` endpoint failure-mode split: rc=7 (35x worker-not-up/restart-race), rc=28 (26x timeout on slow synchronous reindex), rc=52 (46x worker crashes mid-request; most common), rc=56 (3x receive failure). Root cause: `_post_reindex` in `worker_handler.py:208` calls `_reindex_files` SYNCHRONOUSLY in the HTTP thread; long-running reindexes time out (rc=28) or crash the worker mid-call (rc=52). Fix shape (deferred to dedicated cycle): convert to async kickoff returning 202 Accepted + status URL; caller polls separately. Landed 2026-05-11 (diagnosis + handler citation). (auto-shipped from SPEC checkbox flip)
- [medium] (d) `todo_spec_archive._strip_per_cycle_scratch` added: on archive, `## Deferred to next cycle` section content is replaced with an empty-placeholder comment. Per-cycle scratch was accumulating verbatim across cycles. Durable sections (out-of-scope, Glossary, NEVER lists, How-evolves, Worthiness gate) still preserved. One-time purge applied to the live SPEC. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (c) `tests_failing_in_scope.py` accepts pytest exit code 5 (no tests collected) as ok. Detector's purpose is to surface FAILED tests; "no tests collected" means no failures exist. Closes the false-positive that was logging `no tests ran in 0.01s` to `hme-errors.log` every stop chain. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (b) `_SELF_REFERENCE_FILES` broadened to include `pretooluse_edit.sh`, `verify_landed_block.sh`, `pretooluse_read.sh`, `audit-comment-bloat.py`. Gate-maintenance turns editing these files no longer trip self-fire. All 10 evasion_intent tests still pass. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (a) 90-char comment-line rule landed in audit + pretooluse gate. 751 existing violations queued for separate sweep. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
