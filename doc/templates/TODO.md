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

### Todo - Set 10

#7 3_ get HCI score to 100 — banked concrete static gains this session 94.0→95.1: env-no-fallback (#5), adapter-boundary-registry (declared todo_engine/lifesaver_bridge.py + verifier now skips test_*.py), markdown-invariant (added todo_engine/README.md dir-intent). Remaining to reach exactly 100 is NOT one-turn static work: silent-failure-class (234 unmarked catch sites across 88 files — annotation sweep), cross-context-isolation (11 proxy façade-bypass edges — architectural refactor), runtime-telemetry verifiers (tool-response-latency/context-budget/trajectory-trend/hook-latency — reflect live behavior, not code), and host-local state (env-tamper .env baseline, opencode-host ~/.config machine config). Needs explicit scoping decision per sub-area before bulldozing proxy/hook churn.

#11 4_ verifiers/detectors: eliminated the concrete dual-sourced detector-name stats drift by teaching `_detector_stats.emit_stats(None, verdict, detail)` to derive caller module name and converting all 7 local `_emit_stats` wrappers to pass `None`; added regression in extracted-module suite. Full `@detector(name)` argv/load/emit base remains broader refactor, but no hardcoded `_emit_stats` detector-name literals remain; proxy_extracted_modules 56/56 green [E3]

#12 3_ tools_analysis: string-dispatch if/action chains in ~8 "unified" tools → shared `dispatch(key, table)` like the existing `status_unified/_STATUS_MODES` registry. SCOPE BLOCK needing explicit confirmation: (a) the `_track(name)` half is NOT a clean fold — the 37 `_track` sites use fine-grained report names ("composition_arc", "hotspot_leaderboard") while `@chained(name)` only knows the coarse tool name ("read", "trace"), so folding would collapse 37 usage-stat keys into 8 and change `get_session_intent()` classification inputs (behavior change, not dedup); (b) the dispatch-table unification spans 8 live MCP-service tools. Confirm desired granularity before refactor [E3]
