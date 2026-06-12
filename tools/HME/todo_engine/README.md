Unified TODO engine: parse, render, and lifecycle the status-code TODO.md format.

- `grammar.py` -- parse/render the `#<id> <code> <text>` line format.
- `lifecycle.py` -- status-code transitions (0_/1_/2_/3_/4_/4f_/5_) and timers.
- `store.py` -- read/write `doc/templates/TODO.md` as the single source of truth.
- `lifesaver_bridge.py` -- adapter boundary: LIFESAVER runtime alerts enter the
  engine as ordinary status-0 todos (declared in config/adapter-boundaries.json).

Tests (`test_*.py`) run each module over a temp `PROJECT_ROOT`.
