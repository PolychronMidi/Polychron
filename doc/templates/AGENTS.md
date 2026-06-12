# Rules

This file must remain focused, concise, lean - docs and auto-enforcement handle the rest.

If something potentially auto-enforced would need to be mentioned here, it must be enforced better instead.

- This file (doc/templates/AGENTS.md) -- *operational* rules: workflow style, LOC/comment discipline, plan-execution shape, mode-specific composition vs HME guidance. Changes via normal commit.

Polychron development has two interleaving modes; mode-specific rules live in companion files:
- **Composition** (`src/`) -- [doc/composition.md](../composition.md)
- **HME** (`tools/HME/`) -- [doc/self-coherence.md](../self-coherence.md)

## Universal Principles (operational)

- **Stop hooks.** Never explain declining a stop hook's directive when it doesn't fit. End the turn in silence, or just a minimal ".", immediately if the hook should not apply to the scenario.
- **Single Responsibility / LOC.** Files MUST be <=350 LOC unless listed in `config/loc-ignore.txt`. Organize at logical boundaries.
- **Comments and docs.** Inline comments MUST be concise, single-line, and terse. Elaboration goes in `doc/`, where style retains project-wide focus on concise, focused clarity.
- **Never delete unused code/config before checking if it should be implemented.** Adapt or wire up; only delete when its concerns are already covered elsewhere.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Explicit user lists track 1:1.** For every numbered/bulleted list, keep a
  combined mapping from user item to shipped evidence.
- **Never abandon a plan mid-execution. Always re-plan when execution proves the plan wrong.** Two failure modes, opposite shapes, both gated here:
  - *Premature pivot:* finish the current atomic unit before pivoting. If a solid discovery or user feedback changes direction, explicitly acknowledge the pivot, state what was left undone, and make sure items still needing completion are in todo list. Never leave code/tools in a broken intermediate state. Clarifying questions belong BEFORE starting implementation. Atomic units: a file sweep is not done until every file in scope is fixed; a merge is not done until the routing logic exists; a KB cleanup is not done until every candidate entry has been processed.
  - *Sunk-cost grind:* if execution reveals the plan was wrong (failed assumption, missing dependency, scope misjudged, same fix tried 2+ ways without success), STOP and re-plan. The signal isn't "feels hard"; it's concrete (a discovered fact contradicts the plan's premise). Don't keep pushing a plan whose premise is broken.
- **Act on feedback or discovered issues immediately and thoroughly. Every completion claim MUST carry same-turn evidence.** Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction, do the entire sequence, only pausing to fix issues discovered. Investigate root causes of every bug surfaced -- don't cherry-pick one and ignore the rest.
- **ALL problems are IN-SCOPE for THIS TURN - Every discovered problem MUST be immediately fixed.** No excuses for anything less than total, comprehensive, integrated ownership.
- **NEVER leave unexpected/undesired behavior/results uninvestigated/unfixed.** The only thing that is "none of your business," is the concept "none of your business." Always Know Confidently, or when that's not possible, at least Look until Totally Seeing.
