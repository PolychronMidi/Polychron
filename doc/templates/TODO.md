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

#7 3_ get HCI score to 100 — banked concrete static gains this session 94.0→95.1: env-no-fallback (#5), adapter-boundary-registry (declared todo_engine/lifesaver_bridge.py + verifier now skips test_*.py), markdown-invariant (added todo_engine/README.md dir-intent). Remaining to reach exactly 100 is NOT one-turn static work: silent-failure-class (234 unmarked catch sites across 88 files — annotation sweep), cross-context-isolation (11 proxy façade-bypass edges — architectural refactor), runtime-telemetry verifiers (tool-response-latency/context-budget/trajectory-trend/hook-latency — reflect live behavior, not code), and host-local state (env-tamper .env baseline, opencode-host ~/.config machine config). Needs explicit scoping decision per sub-area before bulldozing proxy/hook churn.

#11 5_ verifiers/detectors: eliminated dual-sourced detector-name/stats/argv/load drift without adding redundant detector annotations. `_detector_stats.emit_stats(None, verdict, detail)` derives identity from the existing detectors/<module>.py path; `_base.py` now owns `transcript_arg()`, `load_turn()`, and `emit_stats()`; the 7 stats-emitting detectors import `emit_stats as _emit_stats, load_turn, transcript_arg` instead of local `_emit_stats` wrappers or direct `sys.argv[1]` loads. Regression coverage updated in detector_base.test.py and proxy_extracted_modules.test.js to assert shared helper use and no `DETECTOR = detector(...)` / `@DETECTOR` ceremony. Verified: detector_base 6/6, proxy_extracted_modules 58/58, run_all --check-declared, detector_chain 72/72 PASS.

#12 1_ tools_analysis: string-dispatch if/action chains in ~8 "unified" tools → shared `dispatch(key, table)` like the existing `status_unified/_STATUS_MODES` registry. Confirmed scope: per-tool mode/action dispatch tables only; do NOT fold `_track(name)` granularity because those fine-grained names feed `get_session_intent()` classification. Convert noisy mode/action ladders without changing telemetry names, MCP decorators, imports, or budget behavior. [E3]
