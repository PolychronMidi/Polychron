# composers/chord

Chord quality selection, voicing, harmonic priors, and progression generation. `ChordManager` is the single hub; `ChordComposer` extends `MeasureComposer` and implements `getVoicingIntent()` — chord tones weight 1, non-chord tones weight 0.

`ChordComposer` updates `harmonicContext` with the active chord set on every call. This is the canonical write path for chord-type context used by downstream voice leading and motif modules — never update `harmonicContext.chord` from outside this dir.

`pivotChordBridge` loads last because it depends on both `ChordComposer` and `ProgressionGenerator` being initialized.

<!-- HME-DIR-INTENT
rules:
  - ChordComposer is the canonical write path for harmonicContext chord state — never update harmonicContext.chord from outside this dir
  - pivotChordBridge loads last; it depends on ChordComposer and ProgressionGenerator — never move it earlier in index.js
-->
