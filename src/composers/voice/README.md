# composers/voice

Per-voice note selection and voice-leading optimization. `VoiceManager` is the single coordinator: it picks voice count from `VOICES` config, collects voicing intent from composers, and delegates joint optimization to `voiceRegistry` + `VoiceLeadingScore`.

## Voicing Intent Pattern

Composers express preferences by implementing `getVoicingIntent(candidateNotes)` returning `{ candidateWeights, registerBias?, voiceCountMultiplier? }`. The voice module then resolves *how* to pick — smooth motion, leap recovery, history continuity. **Never bypass this by writing to `voiceHistoryByLayer` directly** or by calling `voiceRegistry` from a composer; the separation is the invariant.

## Per-layer history

Voice history is keyed by `LM.activeLayer`. Any new state written per-beat that persists across layers needs the same treatment — add to `LM.perLayerState` and save/restore on `activate()`.

<!-- HME-DIR-INTENT
rules:
  - Composers express note preferences via `getVoicingIntent()` weights only — never write to `voiceHistoryByLayer` or call `voiceRegistry` directly from a composer
  - Voice history is per-layer (keyed by `LM.activeLayer`); new persistent per-beat state needs `LM.perLayerState` save/restore treatment
  - `VoiceManager` is the single entry point for voice count and selection — no composer bypasses it for direct note picks
-->
