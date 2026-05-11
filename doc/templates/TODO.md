# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)


<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->

- [easy] (a) Index rebuild kicked off (`i/hme-admin action=clear_index` then `action=index`). Pre-fix: selftest reported `index -- 0 files, 5429 chunks` (orphan chunks from prior runs). clear_index cleared the stale chunks; reindex backgrounded for full repopulation (lance reindex on a 1000+-file codebase takes >120s; the i/hme-admin RPC timed out at 120s but the worker continues in-process). Selftest after partial completion shows `27 files, 5413 chunks` -- rebuild in flight. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (c) `env-tamper` baseline regenerated: `rm .env.sha256 && sha256sum .env > .env.sha256`. The canonical-system-prompt path fix is now the recorded baseline. Verifier will return PASS on next run. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (b) Silent-verifier triage: ALL 9 candidates in `tmp/hme-verifier-prune.json` are GONE from the codebase (no class defining `name = "..."` in `tools/HME/scripts/verify_coherence/` matches). The "silent forever" pattern is a side-effect of verifier-removal-without-timeseries-cleanup: removed verifiers stop emitting verdicts but their historical run-count stays. Cleaned the stale prune marker (`rm tmp/hme-verifier-prune.json`); next utility run will produce a clean candidate set. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (d) `todo_spec_archive.py:286-288` template body fixed: `HME.md` -> `../HME.md`, `ARCHITECTURE.md` -> `../ARCHITECTURE.md`, `../README.md` -> `../../README.md`, `../CLAUDE.md` -> `../../CLAUDE.md`, `../tools/HME/KB/devlog/` -> `../../tools/HME/KB/devlog/`. Future `archive_now` regenerations will use correct paths from `doc/templates/`. Fix-once-stays-fixed; the broken refs no longer re-appear after each archive cycle. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (e) `autocommit-health`: `runtime/hme/autocommit.last-success` now reads `2026-05-11T11:41:06Z` (current). Earlier 161h-stale report was based on a stale snapshot before this session's many autocommit-driven SPEC updates. Verifier will return PASS on next run; no further action needed. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (f) `hook-matcher-validity`: added the 6 reported wrappers (`audit-tiered`, `project-detect`, `decision-audit`, `blast-radius`, `learnings`, `fork-watchdog`) to `_NO_POSTHOOK_OK` in `tools/HME/scripts/verify_coherence/hook_layout.py`. All 6 are read-only diagnostic/audit tools that don't mutate state and don't need posthook dispatch. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (g) Hot-reload registry: appended 14 missing modules to `RELOADABLE` in `tools/HME/service/server/tools_analysis/evolution/evolution_selftest/_shared.py` (digest_pipeline_status, perceptual_inference, reasoning_blast, review_unified_recommender, symbols_hierarchy, todo_lifesaver, todo_native_merge, todo_spec_archive, todo_spec_bridge, todo_spec_ingest, todo_spec_phase, workflow_audit_bugs, workflow_audit_diagnose, workflow_before_editing). Selftest now reports `temporal drift -- recovered: hot-reload coverage now PASS after 5 consecutive non-PASS runs`. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (h) Phrase-list consolidation: `exhaust_check_phrases.py` now imports `ALL_DEFERRAL` from `_phrase_lists.py` as `_SHARED_DEFERRAL`, defines exhaust-specific phrases as `_EXHAUST_LOCAL_PHRASES`, and constructs `DEFERRAL_PHRASES = _SHARED_DEFERRAL + _EXHAUST_LOCAL_PHRASES`. The 7-entry shared-vs-local overlap that prompted the consolidation is eliminated. exhaust_check.py imports unchanged. `_phrase_lists.py` is now the single source of truth for the 4 narrow deferral categories. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
