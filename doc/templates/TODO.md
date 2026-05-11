# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)


<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->

- [medium] (a) Shared `_detector_stats.py` shipped with `emit_stats(detector, verdict, detail)` (fcntl-locked append + 5000-line LRU trim + project-root walk). Replaced local `_emit_stats` in all 7 detectors with 3-line shim. 7/7 import cleanly + emit verification lines to `detector-stats.jsonl`. Consolidates ~30 LOC * 7 files. The robust flock+trim pattern (previously only in psycho_stop) now protects all 7 from concurrent-write loss. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
