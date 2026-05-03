# Rules

Keep this file focused, concise, lean - docs and auto-enforcement handle the rest.

If something potentially auto-enforced would need to be mentioned here, make its enforcement better instead.

Polychron development has two interleaving modes; mode-specific rules live in companion files:
- **Composition** (`src/`) — [doc/SRC.md](doc/SRC.md)
- **HME** (`tools/HME/`) — [doc/HME.md](doc/HME.md)

## Universal Principles

- **Fail fast.** Every module throws on bad input. No silent early returns. No `|| 0` / `|| []` fallbacks. No graceful degradation.
- **Single Responsibility / Lines Of Code targets.** Files not listed as exempt in loc-ignore.txt should target max LOC of about 150-350. Organize files in subdirectories at sensible logical boundaries.
- **Comments and docs.** Inline comments should be as terse and reserved as possible, with rare multi-line comments, and elaboration, if needed, in doc/
- **Never delete unused code/config before checking if it should be implemented.** Only delete code that can't be reasonably adapted and whose concerns are already covered elsewhere. Otherwise, wire it up and implement. Understand design intent to preserve/adapt salvageable elements instead of wholesale deletion.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Never abandon a plan mid-execution. Always re-plan when execution proves the plan wrong.** Two failure modes, opposite shapes, both gated here:
  - *Premature pivot:* finish the current atomic unit before pivoting. If user feedback changes direction, explicitly acknowledge the pivot, state what was left undone, and confirm before switching. Never leave code/tools in a broken intermediate state. Clarifying questions belong BEFORE starting implementation. Atomic units: a file sweep is not done until every file in scope is fixed; a merge is not done until the routing logic exists; a KB cleanup is not done until every candidate entry has been processed.
  - *Sunk-cost grind:* if execution reveals the plan was wrong (failed assumption, missing dependency, scope misjudged, same fix tried 2+ ways without success), STOP and re-plan. The signal isn't "feels hard"; it's concrete (a discovered fact contradicts the plan's premise). Don't keep pushing a plan whose premise is broken.
- **Act on feedback or discovered issues immediately and thoroughly. Every completion claim MUST carry same-turn evidence.** Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction, do the entire sequence, only pausing to fix issues discovered. Investigate root causes of every bug surfaced — don't cherry-pick one and ignore the rest. Completion-vocabulary (`works`, `passes`, `fires`, `lands`, `live`, `verified`, `done`) without a same-turn evidence-producing tool call (test output, file path, verification command, health probe) is a violation; auto-enforced by `claim_without_evidence` detector. Words like `should`, `probably`, `seems to`, `looks correct` are also violations — confidence ≠ evidence.
