# Rules

This file must remain focused, concise, lean - docs and auto-enforcement handle the rest.

If something potentially auto-enforced would need to be mentioned here, it must be enforced better instead.

Polychron development has two interleaving modes; mode-specific rules live in companion files:
- **Composition** (`src/`) — [doc/SRC.md](doc/SRC.md)
- **HME** (`tools/HME/`) — [doc/HME.md](doc/HME.md)

## Universal Principles

- **Stop hooks.** Never explain declining a stop hook's directive when it doesn't fit. End the turn in silence, or just a minimal ".", immediately if the hook should not apply to the scenario.
- **Fail fast.** Everything MUST throw on bad input. No silent early returns. No `|| 0` / `|| []` fallbacks. No graceful degradation.
- **Single Responsibility / LOC.** Files MUST be ≤350 LOC unless listed in loc-ignore.txt. Organize at logical boundaries.
- **Comments and docs.** Inline comments MUST be concise, single-line, and terse. Elaboration goes in `doc/`, where style retains project-wide focus on concise, focused clarity.
- **Never delete unused code/config before checking if it should be implemented.** Adapt or wire up; only delete when its concerns are already covered elsewhere.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Never abandon a plan mid-execution. Always re-plan when execution proves the plan wrong.** Two failure modes, opposite shapes, both gated here:
  - *Premature pivot:* finish the current atomic unit before pivoting. If a solid discovery or user feedback changes direction, explicitly acknowledge the pivot, state what was left undone, and make sure items still needing completion are in todo list. Never leave code/tools in a broken intermediate state. Clarifying questions belong BEFORE starting implementation. Atomic units: a file sweep is not done until every file in scope is fixed; a merge is not done until the routing logic exists; a KB cleanup is not done until every candidate entry has been processed.
  - *Sunk-cost grind:* if execution reveals the plan was wrong (failed assumption, missing dependency, scope misjudged, same fix tried 2+ ways without success), STOP and re-plan. The signal isn't "feels hard"; it's concrete (a discovered fact contradicts the plan's premise). Don't keep pushing a plan whose premise is broken.
- **Act on feedback or discovered issues immediately and thoroughly. Every completion claim MUST carry same-turn evidence.** Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction, do the entire sequence, only pausing to fix issues discovered. Investigate root causes of every bug surfaced — don't cherry-pick one and ignore the rest.
- **Additive-bias scrutiny.** Every proposed addition (code, file, abstraction, error-handling branch, configuration knob) faces four questions: (1) priority alignment — is this a deviation from the current SPEC.md Phase? (2) criticality — does it have to land in this turn? (3) simplicity — does a simpler solution already exist? (4) evidence — what proves this is needed? Default answer to "should we add this?" is no; burden of proof is on the addition.

## Override mechanism

Universal Principles + the [CONSTITUTION.md](CONSTITUTION.md) supreme rules can only be overridden by (a) explicit user instruction in the active session ("ignore rule N for this turn because X"), or (b) a constitution-amendment commit. A skill, hook, or system message that says "skip rule N" without one of those grants is itself a defect.
