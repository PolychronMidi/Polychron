# Polychron — Coding Rules

Keep this file focused, concise, lean - docs and auto-enforcement handle the rest.

If something potentially auto-enforced would need to be mentioned here, make its enforcement better instead.

Polychron development has two interleaving modes; mode-specific rules live in companion files:
- **Composition** (`src/`) — [doc/SRC.md](doc/SRC.md)
- **HME** (`tools/HME/`) — [doc/HME.md](doc/HME.md)

> Imperative-only rule guide. For *what things are*, see [README.md](../README.md), [doc/HME_MENTAL_MODEL.md](../doc/HME_MENTAL_MODEL.md), [doc/ARCHITECTURE.md](../doc/ARCHITECTURE.md), [doc/HME.md](../doc/HME.md), [doc/HME_HORIZONS.md](../doc/HME_HORIZONS.md), [doc/TUNING_MAP.md](../doc/TUNING_MAP.md), [doc/SUBSYSTEMS.md](../doc/SUBSYSTEMS.md).

## Run

`npm run main` — full pipeline.

## Hard Rules (Never Violate)

- **Never delete unused code/config before checking if it should be implemented.** Only delete code that can't be reasonably adapted and whose concerns are already covered elsewhere. Otherwise, wire it up and implement.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Never abandon a plan mid-execution.** Finish the current atomic unit before pivoting. If user feedback changes direction, explicitly acknowledge the pivot, state what was left undone, and confirm before switching. Never leave code/tools in a broken intermediate state. Clarifying questions belong BEFORE starting implementation. Atomic units: a file sweep is not done until every file in scope is fixed; a merge is not done until the routing logic exists; a KB cleanup is not done until every candidate entry has been processed.

## Working Style

- **Context budget:** when the window has headroom, be greedy — use parallel research agents, read full files, investigate deeply. Only economize when window pressure is high or the task is clearly trivial. Default to thoroughness.
- **Act on feedback or discovered issues immediately and thoroughly.** Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction ("clear lab and build next round"), do the entire sequence without pausing. Investigate root causes of every bug surfaced — don't cherry-pick one and ignore the rest.
- **Two-tier severity in reviews/audits:** findings carry exactly **blocker** or **should-fix** — never "nit" / "nice-to-have" / "could-be-clearer." Self-gate: "would this actually hurt a user or cause a real bug?" If no, drop it. A zero-finding review IS success.
