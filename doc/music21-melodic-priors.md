# Music21 Melodic Priors Export

This project can consume offline melodic priors via `MELODIC_PRIOR_TABLES` in `src/composers/voice/melodicPriorsData.js`.

## Why offline

Melodic priors are corpus-derived once and then used at runtime as lightweight candidate multipliers during note selection.

## Export command

```bash
python scripts/music21/export_melodic_priors.py --output src/composers/voice/melodicPriorsData.js
```

Useful options:

- `--limit 220` increase/decrease scan depth
- `--source chorales|core` corpus source
- `--max-notes-per-part 420` cap per-part melodic extraction
- `--top-tendencies 24` size of tendency map

## Requirements

```bash
pip install music21
```

## Runtime usage

- `VoiceLeadingScore.selectNextNote(...)` and `VoiceRegistry(...)` apply `melodicPriors.getCandidateWeights(...)` when enabled.
- Enable with `voiceProfile: 'corpusAdaptive'` in `VOICE_PROFILES`.
- Runtime profile forwarding is handled by `ComposerRuntimeProfileAdapter.getVoiceSelectionOptions(...)`.

## Data shape

- `phaseDegreeWeights`: degree preference by phrase phase
- `tendencyWeights`: key-relative melodic transitions (e.g., `11->0`)
