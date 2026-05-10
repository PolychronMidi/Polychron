# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)




<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->



- [E2] Expanded [_phrase_lists.py](../../tools/HME/scripts/detectors/_phrase_lists.py): added 12 phrases to DEFERRAL_FLAG_FOR_LATER (built-but-not-wired, ready-but-not-wired, shipped-but-not-wired, designed-but-not-implemented, ready-but-unused, lurking-observation-only, observation-only-gaps, remains-uninvestigated/unfixed/unused), 13 to DEFERRAL_ACK_NO_FIX (investigated/traced/diagnosed-but-not-fixed, half-done, half-done:, halfway/partially-done/complete, not-yet-wired, never-wired, isn't-yet-wired, remains-uninvestigated, investigated-but-never-reported, discovered/found-but-not-fixed/addressed), 7 to SURVEY_PERMISSION_ASK (if-picking-one, if-picking-just-one, picking-one-to-ship, if-you'd-like, if-you-want-me, the-smallest-item, want-me-to-ship). (auto-shipped from SPEC checkbox flip)
- [E2] Verified live by replaying the exact failure case: simulated transcript with 8 Edit tool calls + my actual "what's missing" closing text. Both detectors now fire correctly: `exhaust_check -> exhaust_violation`, `psycho_stop -> psycho`. Pre-patch: both returned `ok` (silent). (auto-shipped from SPEC checkbox flip)
- [E3] Tightened [exhaust_check.py](../../tools/HME/scripts/detectors/exhaust_check.py) implicit-solo rescue: added `_UNDONE_HEADER` regex matching bold-headers naming undone categories (`**Built but not wired:**`, `**Half-done:**`, `**Investigated but not fixed:**`, etc); when 2+ such headers appear in closing, work-count rescue is suppressed and the phrase scan proceeds. The prior unconditional `n_work >= 3 -> ok` was the structural flaw: a turn can do lots of work AND enumerate more undone work in the same closing. (auto-shipped from SPEC checkbox flip)
- [E1] [project_detect.py](../../tools/HME/scripts/project_detect.py) `--tag` wired into [userpromptsubmit.sh](../../tools/HME/hooks/lifecycle/userpromptsubmit.sh) -- one-line `[project-detect] lang=X | test=Y` echo per prompt so subagents skip per-call stack inference. (auto-shipped from SPEC checkbox flip)
- [E2] Persona hint in claude-resume dispatch path: [buddy_dispatch_lifecycle.py](../../tools/HME/scripts/buddy_dispatch_lifecycle.py) prompt construction now prepends `[persona: <name>] Apply role guidance from .claude/agents/<name>.md to this task.` when `_infer_persona(task)` returns non-empty, complementing the synthesis-path system-prompt swap from Phase 0. (auto-shipped from SPEC checkbox flip)
- [E2] [fork_watchdog.py](../../tools/HME/scripts/fork_watchdog.py) + [i/fork-watchdog](../../i/fork-watchdog) defensive instrumentation against silent-notification harness bug: scans all per-session subagents/agent-*.jsonl, surfaces forks completed (stop_reason set) but in 60s..1h "notification_lost" window. Wired into [sessionstart.sh](../../tools/HME/hooks/lifecycle/sessionstart.sh) with stderr-on-finding-only output. (auto-shipped from SPEC checkbox flip)
- [E2] [learning_extract.py](../../tools/HME/scripts/learning_extract.py) auto-fired in [_archive_set](../../tools/HME/service/server/tools_analysis/todo_spec_archive.py) right after fresh-slate reset -- each `i/todo archive_now` cycle now auto-extracts patterns from the just-snapshotted devlog into KB/learnings.jsonl without manual `i/learnings extract`. (auto-shipped from SPEC checkbox flip)
- [E1] Lock-free consult re-entrancy guard: ALREADY-IMPLEMENTED at [buddy_handoff_consult.py:122-152](../../tools/HME/scripts/buddy_handoff_consult.py) (Q7 resolution from prior cycle). The fork audit was wrong; verified-and-skipped this turn. BUDDY_SYSTEM.md Q1 was already closed. (auto-shipped from SPEC checkbox flip)
- [E2] [project_detect.py](../../tools/HME/scripts/project_detect.py) + [i/project-detect](../../i/project-detect): scans repo root for 11 manifest types (go.mod / package.json / Cargo.toml / pyproject.toml / Gemfile / pom.xml / build.gradle / composer.json / mix.exs / setup.py); emits JSON with detected language(s), test runner, build command. `--tag` mode prints one-line additionalContext for hook injection. (auto-shipped from SPEC checkbox flip)
- [E3] Add `_infer_persona(task) -> str` and `_load_persona(name) -> str | None` helpers in [buddy_dispatch_lifecycle.py](../../tools/HME/scripts/buddy_dispatch_lifecycle.py); replace the hardcoded system prompt at the `_dispatch_to_buddy` synthesis call site with `system = persona_system or _generic_system`. Persona inference reads task.source / task.text for keywords (review/test/doc/...) and returns matching agent name. Body extraction strips YAML frontmatter from .claude/agents/<name>.md. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
