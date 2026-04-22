# mcp/server/tools_analysis/evolution

Evolution-loop internals. `evolution_evolve.py` is the public dispatcher; this dir holds its phases + adjacent tools: selftest (`evolution_selftest.py`), invariant battery (`evolution_invariants.py`), admin (`evolution_admin.py`), explore/design phases, journal + hypothesis registry.

`evolution_invariants.py` is particularly load-bearing: it declares the invariant battery checked by `check_invariants()`. Invariants are declared in `tools/HME/config/invariants.json`; each check-type is dispatched to a `_check_*` function here. Adding a new invariant type = new JSON entry + new `_check_*` handler + register in the `_eval` dispatch.

`_persist_invariant_history()` writes to `metrics/hme-invariant-history.json`. R22 added stale-id pruning; R33 confirmed no regression. Changes to the streak tracking must preserve the prune behavior or retired invariants linger forever.

<!-- HME-DIR-INTENT
rules:
  - evolution_invariants._eval is the single wiring point for new check types (JSON entry + _check_* function + _eval registration)
  - _persist_invariant_history MUST prune stale ids (no longer in config); removing this breaks retirement cleanup
-->
