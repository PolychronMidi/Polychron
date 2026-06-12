# File Format Rules: 1 todo item per line. Each line must start with one of the following todo status codes:
0_ default status upon creation,
1_ in progress,
2_ revisit (default is in 10 minutes, or whenever all todos in list completed, move to top of list as status 0_). Specify minutes by appending like "2_60",
3_ major block via architechtural design, scope, or low confidence/high risk needing explicit confirmation,
4_ nominally complete, but needs a follow-up. Must be followed by the follow-up todo on the next line with the following code,
4f_ follow up todo, automatically becomes status 0_ in 30 minutes, or specify custom minutes like "4f_60" for 60 minutes. If needs qualifier before becoming status 0_, append _q="qualifier explanation here". Auto-added to new todo sets
5_ Completed totally, no danglers, nothing missing.

Example:
#1 5_ make todo template with rules so agents can simply fill out below. Sets with all items marked code 3_ or above get automatically archived in `log/todo` as `set<number>.md`

### Todo - Set 13

#7 5_ get HCI score to 100 — exhausted the reasonable one-turn remainder and raised verified HCI to 99.3 (static 99.6/runtime 98.6, 85 verifiers). Completed concrete fixes: cc auto-compact single-flight and live slot convergence; fail-fast transcript/proxy/policy/session-state paths; cross-context-isolation PASS; opencode-host materialized; activity event registry/doc drift fixed; comment-bloat long-line FAIL cleared; targeted high-value silent-failure and canary/PTTY bridge paths hardened. Remaining non-perfect items are not reasonable bulldoze work: silent-failure-class is a broad historical 253-site audit backlog needing scoped sweeps, trajectory-trend is historical runtime slope that clears only after later good snapshots, and live CLI smoke/plan/conjugate checks are SKIPs awaiting optional live inputs. User authorized marking done once reasonable work was exhausted.

#11 5_ verifiers/detectors: eliminated dual-sourced detector-name/stats/argv/load drift without adding redundant detector annotations. `_detector_stats.emit_stats(None, verdict, detail)` derives identity from the existing detectors/<module>.py path; `_base.py` now owns `transcript_arg()`, `load_turn()`, and `emit_stats()`; the 7 stats-emitting detectors import `emit_stats as _emit_stats, load_turn, transcript_arg` instead of local `_emit_stats` wrappers or direct `sys.argv[1]` loads. Regression coverage updated in detector_base.test.py and proxy_extracted_modules.test.js to assert shared helper use and no `DETECTOR = detector(...)` / `@DETECTOR` ceremony. Verified: detector_base 6/6, proxy_extracted_modules 58/58, run_all --check-declared, detector_chain 72/72 PASS.

#12 5_ tools_analysis: folded string-dispatch if/action ladders to a shared `dispatch(key, table)` helper (`tools_analysis/_dispatch.py`). Converted 8 dispatchers: read(before/explicit modes), find(search+structural modes), trace(snapshot/round/cascade/impact/interaction), coupling path now exposed via `i/evolve focus=coupling`, module_intel, file_intel, glob_search, learn(12 actions). `_track(name)` granularity left untouched — each handler keeps its own report name so `get_session_intent()` inputs are unchanged; no MCP decorator/import/budget behavior changed; cascade:/accept_draft dual-trigger branches kept inline. All routing keys preserved 1:1. Verified: full tools_analysis import OK (all decorators register), dispatcher-route-contract PASS, tool-surface-coverage PASS, all 8 files cLOC<=350, proxy_extracted_modules 58/58, detector_chain 72/72 PASS.
