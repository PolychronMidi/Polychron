# Plan

Driver + peers confer here; durable, user-approvable proposals land here. Nothing in
this file is implemented until the user marks it approved.

## Status legend

- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## Standing constraints

## Phase F2 (approved) -- Quote-provenance fabrication guard

Source: mesh round `fabrication-guard-consult` (red/blue/purple, final synth).
The failure this addresses: an agent fabricating user-attributed quotes that were
never said (literal "fdua" class), asserting them with confidence, and acting on
them. Existing `fabrication_check.py` cannot catch it (closed phrase table for
constancy claims; the fabrication referent is a string attributed to the user,
not a phrase). The build is one new external-check detector; everything else stays
a soft AGENTS.md rule because it is genuinely unenforceable.

### Build: `quote_provenance` detector

- **File:** `tools/HME/scripts/detectors/quote_provenance.py`, sibling of
  `fabrication_check.py`, reusing `_transcript` helpers.
- **Signal:** in the final assistant text, an attributed + delimited quote whose
  span is absent from the real-user-prompt corpus is a fabrication.
  - Parse the RAW assistant text (NOT `strip_quoted` -- the whole signal lives
    inside quoted spans the house infra otherwise discards).
  - Attribution gate: only 2nd-person-subject verbs (`you said/asked/wrote/told
    me`, `your words/message/request`, `as you put it`) followed by a delimited
    quote. Never bare `said`, never undelimited prose.
  - Corpus: ALL real user turns via `is_real_user_prompt` (not just the last),
    with system-banner prefixes stripped (`[ALERT]`, `<task-notification>`,
    `Note:`) so an agent cannot quote injected banner text and escape.
  - Normalize for compare: lowercase, collapse whitespace, fold curly quotes and
    apostrophe contractions, compare alnum-only forms; min quote length 3 to
    avoid firing on `'a'`/`'y'` shortcut letters.
  - Per-span blame: deny on ANY unmatched attributed span; the verdict detail
    must name the offending span verbatim so the agent can correct.
  - HARD-DENY, no `(verified)`-style waiver (that escape in `fabrication_check`
    is provably game-able). Provenance is objective, needs no epistemic escape.
  - Skip the detector's own self-edit turn (mirror an existing
    `_is_self_reference_turn`-style guard) so writing test quotes into this file
    does not self-trip.
- **Verdict:** `DECLARED_VERDICTS = {"ok", "quote_fabrication"}`. Honesty
  ("I don't know", "I can't quote where that came from") contains no attributed
  delimited quote and therefore never fires.
- **Three-point registration (the real wiring cost both peers undercounted):**
  1. `tools/HME/scripts/detectors/registry.json` -- new entry with
     `name/module/fires_when/bash_var/deny/category/scope/owning_invariant/
     fixture_path/why` (deny: true, category: security, scope: transcript).
  2. The module exposes `DECLARED_VERDICTS` (run_all `_check_declared_verdicts`
     fails closed on drift).
  3. `tools/HME/proxy/stop_chain/policies/anti_patterns.js` -- add
     `QUOTE_PROVENANCE` to `readVerdicts()` defaults, a `REASONS` entry, and a
     `if (v.QUOTE_PROVENANCE === 'quote_fabrication') return ctx.deny(...)` line.
- **Negative controls (`test_quote_provenance.py`):**
  - real-quote-of-user -> ok
  - fabricated attributed quote -> quote_fabrication
  - paraphrase, no delimited quote -> ok
  - tool-output quote (no user attribution) -> ok
  - quote of an injected `[ALERT]`/`<task-notification>` banner -> quote_fabrication
  - apostrophe/case/whitespace variance of a real user span -> ok

### Explicit non-goals (kept as soft AGENTS.md rules -- unenforceable)

- Invented causal stories ("over-window", "primer", "degraded gen"): no source
  string to diff against.
- Garble / nonsense-token self-halt: no mechanical boundary between garble and a
  real sha/identifier/non-English token. Rejected entirely, not deferred.
- `(verified)`-style self-disclosed waivers: game-able.
- "Acting on" fabrication in general: only specific consequences (repeated
  `/hme/spawn`) are catchable, and already have guards.

### Residual risk (no mechanism removes)

An agent that paraphrases a fabrication without a delimited attributed quote
("you wanted X" when the user never did) emits no quotable span and passes every
guard. The detector floor catches the literal delimited-quote class ("fdua")
deterministically; the unbounded-paraphrase class stays a model-behavior limit.

### Remaining refinements


### Global acceptance criteria for the shipped subset

- `quote_provenance.py` passes its negative-control suite (all six cases).
- Detector registered in all three wiring points; `run_all.py` declared-verdict
  check and the full detector chain stay green.
- Invariant battery stays green; Python spec leg (`run_py.py`) stays green.
- No new false-positive on legitimate paraphrase, tool-output quoting, or the
  detector's own self-edit turn.
