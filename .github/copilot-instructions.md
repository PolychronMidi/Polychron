# Project Guidelines

## Code Style
- Languages: JavaScript (CommonJS) with selective TypeScript checking.
- Naked-global convention: this project uses "naked globals" (assigned ONLY via side-effect `require` in `index.js` files) for timing and runtime state (see the `languageOptions.globals` section in `eslint.config.mjs`).
  - **Do not** use `global.`, `globalThis.`, `/* global ... */` comments — ESLint blocks them project-wide.
  - Prefer explicit side-effect modules that attach globals rather than scattering ad-hoc global comments.
- Fail-fast philosophy: prefer loud error logging and throwing over quiet validation that could mask problems. Patterns to follow:
  - Log errors compactly in one `throw new Error()` when a precondition is violated.
  - Avoid silent early returns; always throw errors so failures are visible.
  - The only console logs allowed are for script start, successful output, and temporary debug tracing. (Very limited exceptions to this rule, logged as `console.warn(`Acceptable warning: ...`)` act as a sort of pulse-check during long script runs.)

## Architecture
- High-level layout:
  - `src/` — main source code
  - `src/main.js` — main entry point that initializes the system and starts the main loop
  - `src/composers/` — music composition logic (many small composer modules)
  - `src/time/` — timing and timing helpers (globals heavily used)
  - `src/rhythm/`, `src/fx/`, `src/writer/` — domain-specific subsystems
- Global timing/state is an explicit design choice to make timing calculations efficient and visible across modules; follow `src/time/*` patterns when touching timing code.

## Build & Test
- Key commands (agents should call these automatically):
  - `npm run main` - !!! THIS IS THE ONE AND ONLY SCRIPT ALLOWED TO BE CALLED BY AGENTS TO RUN/TEST THE PROJECT (it includes validation and logging).
  - LET COMMANDS FINISH BEFORE MOVING ON - do not progress prematurely - only once the terminal output clearly states the script exited - err on the side of "siting and waiting for nothing" over skipping ahead and abandoning a running script.

## Project Conventions
- Naked globals are intentional and centralized: when adding new globals, prefer a single side-effect module to define them and document the usage in `eslint.config.mjs` (update globals list when necessary).
- Never use intermediary variables instead of the globals directly in the codebase, as this can lead to confusion and errors. Always reference the globals directly to maintain clarity and consistency.
- Never validate or sanitize global values with ad-hoc checks; if a global is expected to have a certain shape or type, ensure it is correctly initialized at the source and rely on fail-fast error handling rather than subversive, quiet "validation," or "graceful degradation."
- Minimal, clear functions are preferred over large validation helpers that suppress errors.
- Prefer `const` and pure functions where possible, but accept writable globals where the project convention requires it (timing, play-state, debug helpers).
- Prefer files that are small and focused on a single responsibility (target max of roughly 150-200 lines), with clear file names matching the file's main function/class.
---
If anything here is unclear or missing (e.g., additional globals, specific exception patterns), please point me to files or describe the intended behavior and I will update these instructions.
