# Music21 Harmonic Priors Export

This project can consume offline harmonic priors via `HARMONIC_PRIOR_TABLES` in `src/composers/chord/harmonicPriorsData.js`.

## Why offline

Runtime generation stays lightweight and deterministic. Corpus analysis is done ahead of time.

## Export command

```bash
python scripts/music21/export_harmonic_priors.py --output src/composers/chord/harmonicPriorsData.js
```

Safe/faster defaults are now built in:

- source: `chorales`
- bounded chordify measures: `48`
- bounded romanized chords per score: `320`
- progress logging every `25` processed scores

If you still hit slow runs on your machine:

```bash
python scripts/music21/export_harmonic_priors.py --output src/composers/chord/harmonicPriorsData.js --skip-chordify --limit 140
```

Or keep chordify but tighten bounds:

```bash
python scripts/music21/export_harmonic_priors.py --output src/composers/chord/harmonicPriorsData.js --max-measures 24 --max-chords-per-score 180
```

## Requirements

```bash
pip install music21
```

## Output shape

- `major.patterns` / `minor.patterns`: named Roman templates with `baseWeight`, `cadence`, `cadential`
- `phaseWeights`: per-phase weighting (`opening`, `development`, `climax`, `resolution`)

## Runtime usage

- `ProgressionGenerator.random()` consumes `harmonicPriors.getRomanProgression(...)`
- `HarmonicRhythmComposer` supports `progression: 'corpus'`
- `TensionReleaseComposer` and `ModalInterchangeComposer` now initialize from corpus-weighted progression selection
