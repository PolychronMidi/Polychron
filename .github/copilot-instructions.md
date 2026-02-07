# Project Guidelines

## Code Style 🔧
- Languages: JavaScript (CommonJS) with selective TypeScript checking.
- Naked-global convention: this project uses "naked globals" (assigned ONLY via side-effect `require` in `index.js` files) for timing and runtime state (see the `languageOptions.globals` section in `eslint.config.mjs`).
  - **Do not** use `global.`, `globalThis.`, `/* global ... */` comments — ESLint blocks them project-wide.
  - Prefer explicit side-effect modules (e.g., `scripts/utils/stripAnsi.js`) that attach globals rather than scattering ad-hoc global comments.
- Fail-fast philosophy: prefer loud error logging and exiting over quiet validation that hides problems. Patterns to follow:
  - Log errors with `console.error()` and exit when a precondition is violated.
  - Avoid silent early returns; use explicit logging or throw errors so failures are visible (enforced by `local/no-silent-early-return`).

## Architecture 💡
- High-level layout:
  - `src/` — main source code
  - `src/main.js` — main entry point that initializes the system and starts the main loop
  - `src/composers/` — music composition logic (many small composer modules)
  - `src/time/` — timing and timing helpers (globals heavily used)
  - `src/rhythm/`, `src/fx/`, `src/writer/` — domain-specific subsystems
- Global timing/state is an explicit design choice to make timing calculations efficient and visible across modules; follow `src/time/*` patterns when touching timing code.

## Build & Test ✅
- Key commands (agents should call these automatically):
  - `npm run main` - THIS IS THE ONLY SCRIPT ALLOWED TO BE CALLED BY AGENTS TO RUN THE PROJECT (it includes necessary setup and logging)

## Project Conventions 📌
- Naked globals are intentional and centralized: when adding new globals, prefer a single side-effect module to define them and document the usage in `eslint.config.mjs` (update globals list only when necessary).
- Never use intermediary variable instead of the globals directly in the codebase, as this can lead to confusion and errors. Always reference the globals directly to maintain clarity and consistency.
- Nevery validate or sanitize global values with ad-hoc checks; if a global is expected to have a certain shape or type, ensure it is correctly initialized at the source and rely on fail-fast error handling rather than quiet validation.
- Minimal, clear functions are preferred over large validation helpers that suppress errors.
- Prefer `const` and pure functions where possible, but accept writable globals where the project convention requires it (timing, play-state, debug helpers).
- Keep test code free from the naked-global enforcement (tests are deliberately excluded in ESLint config).

---
If anything here is unclear or missing (e.g., additional globals, specific exception patterns), please point me to files or describe the intended behavior and I will update these instructions. ✨
