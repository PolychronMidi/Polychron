# Type Checking Plan (Gradual Adoption)

Goal: Add TypeScript-based type checking to catch API/shape errors and improve refactor safety while keeping the project CommonJS and JS-first.

Phases (todo checklist)

1. Phase 1 — Minimal non-invasive checks (Quick win) — DONE ✅
   - [x] Add `tsconfig.json` with `allowJs`, `checkJs`, `noEmit` and `strict: true`.
   - [x] Add npm script `type-check: "tsc -p tsconfig.json"`.
   - [x] Install `typescript` as a dev dependency (and `@types/node`).
   - [x] Run `npm run type-check` locally and capture diagnostics (initial sweep focused on `src/`).
   - Acceptance: `tsc` runs and reports issues. Initial focused run found ~3,013 diagnostics in core `src/` files; created `src/types/global.d.ts` to reduce obvious noise.

Notes from Phase 1
- Installed: `typescript`, `@types/node` and added `tsconfig.json` with `include: ["src/**/*"]` to focus initial checks on source files.
- Initial run: narrowed target to `src/` to avoid tests and scripts noise; produced a manageable set (~3k) of diagnostics concentrated in `src/time.js`, `src/stage.js`, and `src/writer.js` among others.
- Low-friction mitigation: added `src/types/global.d.ts` with ambient declarations for runtime globals (e.g., `LM`, `PPQ`, helpers) to reduce the most obvious, non-actionable errors.

2. Phase 2 — Reduce noise and document patterns (in progress)
   - [ ] Triage top noisy files from Phase 1 and add JSDoc annotations and `// @ts-check` where helpful.
   - [ ] Add `// @ts-ignore` sparingly with a TODO comment + issue number for true false positives.
   - [ ] Provide concrete conversion examples (start with `src/writer.js`) and document the changes here.
   - Acceptance: At least 60% of reported diagnostics in core `src/` are resolved or annotated.

Phase 2 planned steps (detailed)
- Pick a high-signal file (`src/writer.js` recommended).
  - Add per-file `// @ts-check` and key JSDoc typedefs for frequently used shapes (units, buffer events, layer state).
  - Replace any `Object`/brute-dynamic indexing with small type-safe guards or `/** @type {Record<string, any>} */` local annotations.
  - Where necessary add `// @ts-ignore TODO: see issue #NN` for noisy but low-value checks and open an issue to revisit.
  - Re-run `npm run type-check` and capture the delta in reported errors.
- Iterate across next-high noise files (`src/time.js`, `src/stage.js`, `src/play.js`) with the same pattern.

3. Phase 3 — CI integration & non-blocking enforcement
   - [ ] Add `npm run type-check` to CI as a report-only job and add a badge/status (non-blocking initially).
   - [ ] Consider failing PRs only for a curated subset of `src/` modules once they are stabilized.

4. Phase 4 — Tighten rules & convert hotspots
   - [ ] Add stricter `tsconfig.src.json` for `src/` only (e.g., `noImplicitAny`, tighter libs) once core files are annotated.
   - [ ] Convert critical modules to `.ts` or add `.d.ts` declarations where long-term typing benefit is high.

5. Phase 5 — Broader adoption & maintenance
   - [ ] Document JSDoc conventions and provide examples.
   - [ ] Periodic sweeps to convert additional files or add `.d.ts` declarations for third-party helpers.

Implementation notes
- Prefer JSDoc+`// @ts-check` for incremental adoption: keeps files as `.js` and provides useful editor feedback.
- Use `skipLibCheck` to avoid third-party noise; consider `paths`/`typeRoots` if adding `.d.ts` files.
- When noisy dynamic code exists, favor small refactors (explicit object shapes) over blanket `any` to preserve signal.

Suggested commands and quick checks
- Run the focused checker: `npm run type-check`
- To see the top file counts quickly (Unix): `npm run type-check 2>&1 | grep -E "^\s*[0-9]+" -A1 | sed -n '1,50p'` (adjust for Windows as needed)

Next action (Phase 2, step 1): Start triage on `src/writer.js` — add JSDoc typedefs for unit/buffer shapes, enable `// @ts-check` in the file, and iteratively reduce noise. I will begin by applying those safe, local annotations and re-running the type-check to show the delta.
