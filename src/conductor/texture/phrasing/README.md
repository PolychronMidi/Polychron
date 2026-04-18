# conductor/texture/phrasing

Phrasing signal extraction — motivic density, orchestration weight, pedal point detection, phrase length momentum, repetition fatigue, and fragment helpers. All pure query APIs.

`orchestrationWeightTracker` classifies notes into bass/mid/treble bands using fixed MIDI boundaries (bass ≤55, mid ≤72). These boundaries are hardcoded — not config. If you adjust them you must re-calibrate `suggestion` thresholds in the same file; they are co-designed.

`repetitionFatigueMonitor` accumulates fatigue that biases `composerFeedbackAdvisor` in `texture/form/`. The signal flows upward via polling — never call `composerFeedbackAdvisor` from here.

<!-- HME-DIR-INTENT
rules:
  - All modules are pure query APIs — no writes to conductor or crossLayer state
  - MIDI band boundaries in orchestrationWeightTracker (55/72) are hardcoded and co-designed with suggestion thresholds — adjust them together or not at all
-->
