# Polychron — Coding Rules

Keep this file focused, concise, lean - docs and auto-enforcement handle the rest.

If something potentially auto-enforced would need to be mentioned here, make its enforcement better instead.

Polychron development has two interleaving modes. Most days are mixed: an HME-side change to support a `src/` exploration, a `src/` discipline check via HME's hooks. Both spaces evolve as synergistic-but-distinct partners.

- **Composition** (`src/`) — the polyrhythmic engine itself: 64 cross-layer modules, 18 hypermeta controllers, 27 trust-scored systems. Mode-specific rules: [doc/SRC.md](doc/SRC.md).
- **HME** (`tools/HME/`) — the cognitive scaffolding: proxy middleware, stop-chain detectors, KB, agent infrastructure. Mode-specific rules and tool reference: [doc/HME.md](doc/HME.md).

For *what things are* (orientation, not rules), see [README.md](README.md), [doc/HME_MENTAL_MODEL.md](doc/HME_MENTAL_MODEL.md), [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md).

## Run

`npm run main` — full pipeline. **Never run individual pipeline scripts directly.**

## Universal Principles

- **Fail fast.** No silent fallbacks (`|| 0`, `|| []`), no graceful degradation. Every module throws on bad input. Use the project's `validator` over raw `typeof` / `|| X` / ternary fallbacks.
- **Comments are terse.** No essay comments, no verbose JSDoc. One-line inline only where logic isn't self-evident.
- **No character-spam decoration.** 4+ identical non-word, non-paren chars in a row are banned anywhere — code, comments, docs, generated output. No `====` dividers, `----` separators, `####`+ markdown headings, `||||` table-separator shortcuts, unicode `─`/`═` runs. Markdown table separators must use `| --- |` cells. Per-line opt-out: append the literal token `spam-ok`. Enforced by the `block-character-spam` policy and the `repeated-char-spam` HCI verifier.

## Hard Rules (Never Violate)

- **Binaural is imperceptible neurostimulation only.** Alpha range 8-12Hz. Never go below 8Hz or above 12Hz. Never experiment with binaural frequency. `setBinaural` runs from `grandFinale` post-loop walk ONLY, never from `processBeat`.
- **Never delete unused code/config before checking if it should be implemented.** Only delete code that can't be reasonably adapted and whose concerns are already covered elsewhere. Otherwise, wire it up and implement.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Never abandon a plan mid-execution.** Finish the current atomic unit before pivoting. If user feedback changes direction, explicitly acknowledge the pivot, state what was left undone, and confirm before switching. Never leave code/tools in a broken intermediate state. Clarifying questions belong BEFORE starting implementation. Atomic units: a file sweep is not done until every file in scope is fixed; a merge is not done until the routing logic exists; a KB cleanup is not done until every candidate entry has been processed.

## Working Style

- **User messages via system-reminder:** respond immediately. Do not wait for any running process or tool call to finish first. Drop everything and reply now. Resume prior work after responding, unless the message says to stop.
- **Context budget:** when the window has headroom, be greedy — use parallel research agents, read full files, investigate deeply. Only economize when window pressure is high or the task is clearly trivial. Default to thoroughness.
- **Act on feedback or discovered issues immediately and thoroughly.** Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction ("clear lab and build next round"), do the entire sequence without pausing. Investigate root causes of every bug surfaced — don't cherry-pick one and ignore the rest.
- **Two-tier severity in reviews/audits:** findings carry exactly **blocker** or **should-fix** — never "nit" / "nice-to-have" / "could-be-clearer." Self-gate: "would this actually hurt a user or cause a real bug?" If no, drop it. A zero-finding review IS success.
