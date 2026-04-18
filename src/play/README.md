# play

The composition engine — beat pipeline, layer alternation, note emission, and the main section/phrase/measure hierarchy. `main.js` is the top-level orchestrator; `processBeat.js` runs the per-beat pipeline; `layerPass.js` alternates L1/L2 via `LM.activate()`.

`feedbackGraphContract.js` declares all registered feedback loops and firewall ports for this subsystem. Any new feedback loop added to `play/` must be registered there; check-hypermeta-jurisdiction.js validates this on every run.

`setBinaural` is called from `grandFinale` post-loop walk only — never from `processBeat` or any per-beat handler. This is an absolute rule (see CLAUDE.md). The alpha range 8–12Hz is fixed.

**`emitPickCrossLayerRecord` and `emitPickTextureEmit` load before `playNotesEmitPick`** — the pick emission chain has a strict initialization order in `index.js`.

<!-- HME-DIR-INTENT
rules:
  - setBinaural runs from grandFinale post-loop walk ONLY — never from processBeat or any per-beat path; alpha range 8-12Hz is fixed
  - New feedback loops must be declared in feedbackGraphContract.js — check-hypermeta-jurisdiction.js validates this
-->
