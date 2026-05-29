# Polychron / HME Evolution Plan — for review

**Status: PROPOSAL. No implementation until cleared by user.**
Scope locked to HME substrate only (`tools/HME/`). `src/` is out of scope.

Produced by Agent1 ↔ Agent2 brainstorm (`chat.md`). Every claim below was
verified against source before inclusion — line refs are real.

---

## How we got here

Two candidate areas were probed: HME↔engine coupling and KB freshness. The
agnostic-core boundary (`config/project-adapter.json`) verified as clean and
intentional — not a target. KB-freshness and generator-header ideas were
dropped as too generic / trivial. Focus narrowed to **implicit contracts inside
HME** — places where runtime behavior is real but undeclared, so audits can
report green while the truth lives only in code shape. That is the DDoC profile:
coherent-looking surface, silent internal contradiction.

---

## Target #1 (primary) — Dispatcher routing is an implicit contract

**The seam (verified):**
- `tools/HME/event_kernel/dispatcher.js:493-499` — `case 'PermissionRequest'`
  calls `_runUnifiedPolicies('PreToolUse', tool, empty)`.
- The header contract (`dispatcher.js:19`) describes `PermissionRequest` only as
  a "shared policy gate for Codex approval prompts" — it **never declares** that
  PermissionRequest reuses the **PreToolUse** policy context.

**Why it's the top win:** the routing table for 24+ event/tool routes exists only
as an implicit `switch` shape plus prose comments. "What governs event X" is
verifiable only by reading JS, not by querying an artifact. A policy author
targeting `PreToolUse` unknowingly governs `PermissionRequest` too — and nothing
flags it. This is a substrate-level multiplier: every downstream audit inherits
the undeclared route silently.

**Smallest change that closes it (proposed, not yet built):**
- Extract `dispatcher-routes.json`: one entry per route
  `{ eventName, toolPattern, handler, policyContext }`.
- **Drive the dispatch table FROM the JSON** (load at startup, build routes from
  entries) rather than documenting the switch alongside it.
- The `PermissionRequest → policyContext: "PreToolUse"` reuse becomes an
  explicit, auditable fact.

**Sharpest risk (and its mitigation):** if JSON merely *documents* a switch that
still *drives*, we create a dual source of truth — a new `case` added without a
JSON entry makes any verifier lie green while dispatch grows silently. This is
worse than ordinary schema drift because the PermissionRequest→PreToolUse reuse
is **not mechanically derivable** from the switch; it must be authored. **Mitigation
collapses the dual-authority problem:** make the JSON *be* the switch (data-driven
dispatch), so drift is structurally impossible, not merely verifier-checked.

---

## Target #2 (runner-up) — `phases.json` self-admits it isn't authoritative

**The seam (verified):**
- `tools/HME/proxy/middleware/phases.json` `_doc` field literally says:
  *"File prefixes still define order; this file names the canonical phase
  ranges…"* — i.e. it confesses it is **not** runtime-authoritative.
- `index.js:285` reads it (`PHASES_FILE`), so audits/docs treat it as ground
  truth for phase ranges.
- Phases use integer ranges (e.g. `strip: [5,6]`), but six middleware files use an
  **`a`-suffix** convention — `00a`, `04a`, `06a`, `08a`, `20a`, `25a` — nowhere
  declared in `phases.json`. An audit classifying middleware by phase silently
  misclassifies `06a` unless the reader knows the undocumented "integer part
  governs" rule.

**Why it ranks second, not first:** it is an ordering/classification ambiguity,
not an undeclared *behavioral* contract — lower blast radius than #1. It beats
the 1328-LOC `proxy_extracted_modules.test.js` candidate because test specs are
already LOC-exempt and test sprawl is a different problem class than an
implicit contract.

**Direction (not yet detailed):** make `phases.json` express the `a`-suffix
ordering rule explicitly (or make file-prefix ordering derive from the registry),
so phase classification has one declared source.

---

## What we are NOT doing
- No `src/` changes (out of scope).
- No new "just add a verifier" surface unless it removes an implicit contract.
- No generator/header-comment tweak (too trivial).

## Open questions for you
1. Approve Target #1's data-driven-dispatch approach, or prefer JSON-as-docs +
   a drift verifier (we argue against this — see risk)?
2. Is Target #2 worth including now, or defer?
3. Any HME area you'd rather we probe instead before locking scope?
