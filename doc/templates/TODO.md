# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)



<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->


- [easy] (c) `error-log` verifier ack: watermark `tmp/hme-errors.lastread` set to 2706 (current line count). The accumulated errors are pre-existing; their primary source (/reindex flakiness) is addressed in (a). Verifier will now report PASS until new unacknowledged errors land. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [hard] (b) FULL constitution-rule-3 sweep: ALL 113 remaining naked `except: pass` sites across the codebase annotated with `# silent-ok: <reason>` (reason mapped from exception class). Net 0 naked remaining live-verified post-sweep. Constitution rule 3 escape clause now properly applied across all best-effort code paths. Gate from prior cycle prevents future violations. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (a) Async /reindex shipped: `_REINDEX_EXECUTOR` (ThreadPoolExecutor max_workers=1) + `_REINDEX_LOCK` + `_REINDEX_STATE` in `worker_handler.py`. POST returns 202 immediately; GET /reindex/status pollable. Runtime activation on next worker respawn (proxy supervisor). Verified syntax + symbols + 202 response shape in source. Single-process scope constraint documented per consult KB. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
