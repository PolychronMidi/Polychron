# Lab

Sketch playground for prototyping behavior before promoting to `src/`. Each sketch in `sketches.js` monkey-patches globals or functions at load time via `postBoot()` and runs the engine against an isolated temp working directory — never touches the real `src/output/`.

Lab sketches are how architectural prototypes get auditioned: can a new coupling pair produce audible behavior? Does a proposed controller actually move the regime? A sketch either creates something you can hear, or it proves the hypothesis was wrong. `setActiveProfile()`-only sketches test nothing.

## Structure

- `run.js` — sketch runner; creates isolated temp cwd, runs the engine, emits `.wav` to `src/lab/output/`
- `sketches.js` — all sketches; each exports `{name, setup(), postBoot()}`
- `output/` — rendered `.wav` files (git-ignored)

## Running

```bash
node src/lab/run.js                      # all sketches
node src/lab/run.js <sketch-name> ...    # specific sketches
```

Wall timeout: 180s per sketch. Concurrent with `npm run main` — sketches get their own tmp cwd so lab output cannot contaminate the real pipeline.

## Validator bonds

Every sketch's `postBoot()` must create audible behavior via real monkey-patching. This is enforced by `check-lab-sketch-viability` (runtime): a sketch that produces no `.wav` or whose `postBoot` is a no-op is treated as FAIL.

<!-- HME-DIR-INTENT
rules:
  - Every `postBoot()` must create AUDIBLE behavior via real monkey-patching; a `setActiveProfile()`-only sketch is empty and tests nothing
  - Never use V (validator) inside sketches — use `Number.isFinite` directly; validator context is not available in the lab runner
  - Never use crossLayerHelpers inside sketches — inline the layer logic instead
  - Return values from void functions (e.g. `playNotesEmitPick`) are ignored and indicate misunderstanding — trace the original signature
  - Lab output is isolated in temp cwd; never write to `rootDir/src/output/` from a sketch
-->
