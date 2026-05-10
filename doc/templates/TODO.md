# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)







<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->






- [E1] [tier_classifier.py](../../tools/HME/scripts/tier_classifier.py) `--why` flag: reads last entry of mode-classifier.jsonl and prints mode + tier + reason + matched_signal + ts. Smoke-tested live: `mode=ALGORITHM tier=E5 reason: explicit /e5 override`. Closes B5 from prior enumeration; classifier transparency on demand. (auto-shipped from SPEC checkbox flip)
- [E2] [fork_watchdog.py](../../tools/HME/scripts/fork_watchdog.py) transcript rotation: `_rotate_old_transcripts` moves agent-*.jsonl + .meta.json older than 7 days into sa_dir/.archive/. Live scan went from 116 to 4 forks (rotated 112 historical) so the watchdog is O(recent) not O(all-history). Closes B3. (auto-shipped from SPEC checkbox flip)
- [E2] [learning_extract.py](../../tools/HME/scripts/learning_extract.py) decision-extraction: `_DECISION_RE` matches "chose X over Y" / "picked X instead of Y" / etc patterns in completion paragraphs; new "decision" category in patterns. Closes A2 (lighter-weight version than separate decisions.jsonl since it captures from existing prose). (auto-shipped from SPEC checkbox flip)
- [E2] [pile_on.py](../../tools/HME/scripts/detectors/pile_on.py): refined heuristic distinguishes refinement from stacking. Fires only when 2+ touched files include a NEW (Write-not-Edit) detector file OR 3+ existing detector files edited. Single-bug-spread-across-2-existing-detector-files no longer false-fires. (auto-shipped from SPEC checkbox flip)
- [E2] Wired learning_extract auto-prime into [sessionstart.sh](../../tools/HME/hooks/lifecycle/sessionstart.sh): extracts the latest Phase title from SPEC.md (`### Phase N: <title>` pattern), splits hyphens to get the first 4+ char keyword, calls `learning_extract.py surface --keyword <kw> --top 3` with output to stderr (visible in session). Smoke-tested live: extracted "specialist" from "specialist-memory-auto-append" Phase title; current learnings.jsonl has no matches (current cycle not yet archived to devlog), works as designed. (auto-shipped from SPEC checkbox flip)
- [E2] Added `_append_persona_memory(persona, task, response_text)` helper in [buddy_dispatch_lifecycle.py](../../tools/HME/scripts/buddy_dispatch_lifecycle.py): writes one structured line per successful synthesis-routed task to `.claude/agent-memory/<persona>/MEMORY.md` -- `- {iso_ts} task={id} src={source}: {first_160_chars_of_response}`. Best-effort + bounded; persona itself can compact later when MEMORY.md grows. Invoked at the synthesis-success return path right before the verdict dict, so memory only grows on outcome=done. (auto-shipped from SPEC checkbox flip)
- [E2] Expanded [_phrase_lists.py](../../tools/HME/scripts/detectors/_phrase_lists.py): added 12 phrases to DEFERRAL_FLAG_FOR_LATER (built-but-not-wired, ready-but-not-wired, shipped-but-not-wired, designed-but-not-implemented, ready-but-unused, lurking-observation-only, observation-only-gaps, remains-uninvestigated/unfixed/unused), 13 to DEFERRAL_ACK_NO_FIX (investigated/traced/diagnosed-but-not-fixed, half-done, half-done:, halfway/partially-done/complete, not-yet-wired, never-wired, isn't-yet-wired, remains-uninvestigated, investigated-but-never-reported, discovered/found-but-not-fixed/addressed), 7 to SURVEY_PERMISSION_ASK (if-picking-one, if-picking-just-one, picking-one-to-ship, if-you'd-like, if-you-want-me, the-smallest-item, want-me-to-ship). (auto-shipped from SPEC checkbox flip)
- [E2] Verified live by replaying the exact failure case: simulated transcript with 8 Edit tool calls + my actual "what's missing" closing text. Both detectors now fire correctly: `exhaust_check -> exhaust_violation`, `psycho_stop -> psycho`. Pre-patch: both returned `ok` (silent). (auto-shipped from SPEC checkbox flip)
- [E3] Tightened [exhaust_check.py](../../tools/HME/scripts/detectors/exhaust_check.py) implicit-solo rescue: added `_UNDONE_HEADER` regex matching bold-headers naming undone categories (`**Built but not wired:**`, `**Half-done:**`, `**Investigated but not fixed:**`, etc); when 2+ such headers appear in closing, work-count rescue is suppressed and the phrase scan proceeds. The prior unconditional `n_work >= 3 -> ok` was the structural flaw: a turn can do lots of work AND enumerate more undone work in the same closing. (auto-shipped from SPEC checkbox flip)
- [E1] [project_detect.py](../../tools/HME/scripts/project_detect.py) `--tag` wired into [userpromptsubmit.sh](../../tools/HME/hooks/lifecycle/userpromptsubmit.sh) -- one-line `[project-detect] lang=X | test=Y` echo per prompt so subagents skip per-call stack inference. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
