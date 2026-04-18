# conductor/texture/form

Structural form tracking — section length, silence distribution, textural gradient, textural memory, rest density, and composer feedback. All modules are pure query APIs.

`composerFeedbackAdvisor` loads last and synthesizes from all other modules in this dir (repetition fatigue, textural memory, thematic recall, profile adaptation). It produces per-family weight *adjustments* — advisory signals, not direct writes to any composer weight or registry. Never use it to force a composer selection; it biases probabilities only.

<!-- HME-DIR-INTENT
rules:
  - composerFeedbackAdvisor loads last — it depends on all other form trackers; never move it earlier in index.js
  - It produces weight adjustment signals only — never write composer weights or registry entries from this dir
-->
