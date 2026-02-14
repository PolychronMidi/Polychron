# Music21 Voice-Leading Priors Export

This project can consume offline voice-leading priors via `VOICE_LEADING_PRIOR_TABLES` in `src/composers/voice/voiceLeadingPriorsData.js`.

## Why offline

Voice-leading priors are corpus-derived once and then used as lightweight score adjustments during runtime note selection.

## Export command

```bash
python scripts/music21/export_voice_leading_priors.py --output src/composers/voice/voiceLeadingPriorsData.js
```

Useful options:

- `--limit 220` increase/decrease scan depth
- `--source chorales|core` corpus source
- `--max-notes-per-part 420` cap per-part melodic extraction
- `--top-tendencies 28` size of tendency map

## Requirements

```bash
pip install music21
```

## Runtime usage

- `VoiceLeadingCore.computeCandidateScore(...)` applies `voiceLeadingPriors.getCandidateAdjustment(...)` when corpus priors are enabled.
- Enable with `voiceProfile: 'corpusAdaptive'` (new in `VOICE_PROFILES`).
- `voiceLeading` composer profile `corpusAdaptive` wires this toggle end-to-end.

## Data shape

- `phaseIntervalWeights`: interval preference by phrase phase
- `phaseDirectionWeights`: up/down/static preference by phase
- `tendencyWeights`: key-relative degree transitions (e.g., `11->0`)
