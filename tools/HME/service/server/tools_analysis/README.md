# mcp/server/tools_analysis

Public agent-facing tools live here. Each major tool is a unified dispatcher that auto-routes by argument shape: `evolution_evolve.py` → evolve, `review_unified.py` → review, `learn_unified.py` → learn, `trace_unified.py` → trace, `status_unified.py` → status, `read_unified.py` → read (hidden), `todo.py` → todo.

Subdirectories group related internals: `evolution/` (selftest, invariants, admin, explore, design, journal), `coupling/`, `synthesis/`. `health.py` owns selftest checks; `blindspots.py` owns Phase 2.4 blind-spot surfacing; `cascade_analysis.py` owns Phase 2.5 cascade prediction.

When adding a new mode to an existing dispatcher, add its branch to the dispatcher's `if mode == "..."` ladder AND update the dispatcher's docstring so it lists the mode. The docstring drives doc-sync — undeclared modes fail that invariant.

<!-- HME-DIR-INTENT
rules:
  - Each unified dispatcher owns one public tool; new modes MUST be added to the dispatch ladder AND to the docstring — doc-sync fails on undeclared modes
  - Internals (health.py, blindspots.py, cascade_analysis.py) are called via unified dispatchers; never invoke directly from i/ wrappers
-->
