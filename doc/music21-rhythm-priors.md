# Music21 Rhythm Priors Export

This project can consume offline rhythm priors via RHYTHM_PRIOR_TABLES in src/rhythm/rhythmPriorsData.js.

## Why offline

Rhythm priors are corpus-derived once and then used at runtime as lightweight weight multipliers for rhythm pattern selection.

## Export command

```bash
python scripts/music21/export_rhythm_priors.py --output src/rhythm/rhythmPriorsData.js
```

Useful options:

- --limit 220 increase/decrease scan depth
- --source chorales|core corpus source
- --max-notes-per-part 500 cap per-part rhythmic extraction
- --part-limit 8 max parts per score

## Requirements

```bash
pip install music21
```

## Runtime usage

- getRhythm(...) applies rhythmPriors.getBiasedRhythms(...) when corpus rhythm priors are enabled in the active composer runtime profile.
- Enable via rhythmProfile: 'corpusAdaptive' (adds useCorpusRhythmPriors + corpusRhythmStrength).
- Works with existing FX feedback weighting: FX feedback adjusts base weights first, corpus rhythm priors then apply phase/cadence-conditioned multipliers.

## Data shape

- phaseMethodWeights: per-phase method weighting (binary, euclid, onsets, etc.)
- levelPhaseMultipliers: per-level (beat/div/subdiv/subsubdiv) phase multipliers
- cadentialMethodWeights: method weighting boost/suppression at phrase boundaries
