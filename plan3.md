# Polychron / HME Evolution Plan #3 — for review

**Status: PROPOSAL. No implementation until cleared by user.**
Scope: HME substrate only. Same lens as plan.md / plan2.md — *declared-vs-actual
divergence* — now turned on the verifier layer as a CLASS, not one instance.

Produced by Agent1 ↔ Agent2 (`chat.md`, max-effort). Claims verified against
source; line refs real.

---

## Target — Harden the whole "advisory-swallow + phantom scaling" verifier class

plan2 fixed `StateFileOwnershipVerifier`, which swallowed drift via
`passed(score=1.0, "… tracked in canonical backlog")`. That idiom has **direct
structural twins**. This plan hardens the class in one pass.

### Primary: `SilentFailureClassVerifier` (`code_audits_test.py:48-65`)
- **Overpromise (verified):** inline comment says *"Logarithmic scaling —
  expected count is in the hundreds today"* (line 60) but the code is a flat
  binary `<= 50` cutoff. Above 50 it returns `passed(score=1.0, "… tracked in
  canonical backlog")` — **identical verdict whether count is 51 or 5,000**.
- **Consequence:** a regression that triples unmarked silent-catch sites is
  invisible by construction. The declared scaling model doesn't exist.
- **Twin:** `code_audits_syntax.py:71` — undefined-variable refs use the exact
  same `passed(score=1.0, "… tracked in canonical backlog")` swallow. Same fix.

### Secondary: substring-decides-the-verdict fragility
- `OnboardingFlowVerifier` (`onboarding.py:66-80`): derives its **score** from
  `"PASS:" in ln` / `"FAIL:" in ln` counts over raw output. Any detail line that
  mentions those tokens in prose inflates `n_passed`/`n_failed`, so the score can
  silently disagree with the authoritative `rc` it gates on. (This is the same
  class as plan2's "'no drift' contains 'drift'" bug — text deciding what an exit
  code already answered.)

---

## Why this is the highest-leverage next step
The fix is **generalizable**: `grep -rn "passed(score=1.0" verify_coherence/`
mechanically enumerates every clone of the swallow pattern (10 hits today; most
are legitimate "0 problems → pass", but the `… backlog` ones are the swallow).
Hardening the pattern once protects the whole immune system, not one cell.

## Proposed change
1. **Banded verdicts replace the phantom scale.** For `silent-failure-class` and
   the `undefined-variable` twin: keep advisory weight, but return `warned()`
   above threshold (so it's visible, not green), and `failed()` on an **upward
   delta vs recorded history** (a real regression), so "declared scaling" and
   actual behavior finally agree. Persist the last count to a small runtime
   metric for the delta check.
2. **Authoritative signal over substring.** `OnboardingFlowVerifier`: gate on
   `rc`; use the PASS/FAIL counts only for the human-readable summary, never for
   the pass/fail decision. (Mirrors the plan2 fix exactly.)
3. **Prove each can FAIL.** Negative regression tests — inject an upward delta /
   a nonzero rc with misleading prose — asserting the verdict flips, same
   discipline as plan2's `code_audits_state.test.py`.

**Blast radius:** low. 2-3 verifier bodies + one tiny history metric + tests. No
runtime/proxy code.

## Open questions for you
1. For the silent-catch + undefined-var verifiers: **warn-above-threshold +
   fail-on-upward-delta** (proposal), or simpler **hard cap** (fail above N)?
   The delta approach tolerates the existing backlog while blocking regressions;
   a hard cap forces paydown now.
2. Include the `OnboardingFlowVerifier` substring-scoring fix in this plan, or
   split it into its own pass?
3. Want me to also sweep the other 7 `passed(score=1.0 …)` sites to confirm each
   is a legitimate zero-problem pass and not another silent swallow?
