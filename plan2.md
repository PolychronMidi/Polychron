# Polychron / HME Evolution Plan #2 — for review

**Status: PROPOSAL. No implementation until cleared by user.**
Scope: HME substrate only. Continues the plan.md theme: *a declared artifact
and the code that should honor it have silently diverged.*

Produced by Agent1 ↔ Agent2 (`chat.md`, max-effort). Every claim verified
against source — line refs are real.

---

## Target — A verifier lies green about its own gating contract

This is one tier worse than plan.md's targets. Those were declared-artifact-vs-
code gaps a verifier *could* catch. This is the **verifier itself** silently not
enforcing — a coherence illusion inside the substrate's own immune system.

**The seam (verified):**
- `verify_coherence/code_audits_state.py` — `StateFileOwnershipVerifier`.
- Docstring (lines 50-53): *"Weight 1.5 — gating … FAIL on any detected drift;
  the JSON registry is the authoritative source."*
- Code (line 87): when `drift_lines` is non-empty it returns
  `passed(score=1.0, summary="… undeclared writer(s) … tracked in canonical
  backlog")`. It **never calls `failed()`**.
- The underlying `audit-state-file-ownership.py` correctly `return 1`s on drift
  (line 164) — the wrapper swallows that exit code and reports green.
- So an unregistered writer of `hme-errors.log` / `hme-nexus.state` (the exact
  concurrent-append/truncate risk class the verifier was built to gate) is
  detected, counted, and waved through.

**Genuine nuance found while verifying (changes the fix):**
- Current live drift = **3, all in `tools/HME/hooks/pretooluse/bash/_disabled/`**
  (`reader_guards.sh`, `cwd_rewrite.sh`, `blackbox_guards.sh` writing
  `log/hme-errors.log`). These are *disabled* scripts — inert, not live writers.
- So a naive "just call `failed()`" would gate the build on dead code. Wrong.
- Also: "tracked in canonical backlog" is an **established sibling pattern** —
  `code_audits_test.py:64` and `code_audits_syntax.py:71` use the exact same
  `passed(score=1.0, "… tracked in canonical backlog")` shape deliberately
  (advisory, monotonic-decrease, non-gating). The divergence is specifically
  that *this* verifier's docstring promises gating while its body opts into the
  advisory pattern.

**Proposed fix (two coherent parts — reconcile toward gating, per the docstring):**
1. **Make the audit match reality:** add `_disabled` to `SKIP_DIRS` in
   `audit-state-file-ownership.py` (line 47). Disabled scripts are not live
   writers; scanning them is a false positive. This drops live drift to 0.
2. **Restore the declared contract:** change line 87 to `failed(...)` on
   `drift_lines` so a *real* new undeclared writer gates, exactly as the
   docstring states. Registry issues / doc-staleness keep their current
   handling.
3. **Prove it can fail** (the discipline applied to DispatcherRouteContractVerifier):
   a negative test that injects a fake undeclared writer and asserts FAIL.

**Why gating, not the other reconciliation:** the alternative — keep
`passed()`, rewrite the docstring to "advisory, track don't gate", drop weight —
is *also* coherent, but it weakens a guarantee the substrate actively advertises
on its dashboard. Given the risk class (cross-runtime concurrent state writes)
and that drift is genuinely 0 once `_disabled` is excluded, gating costs nothing
now and catches the real thing later.

**Blast radius:** low. One audit constant, one verdict call, one new test. No
runtime/proxy code touched.

## Open questions for you
1. Reconcile toward **gating** (proposal above) or toward **advisory** (rewrite
   docstring + drop weight to match the sibling backlog pattern)?
2. Is excluding `_disabled/` from the audit the right call, or should those
   scripts instead be registered / deleted (they're disabled — likely dead)?
