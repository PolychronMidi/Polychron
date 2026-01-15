# motifs.js - Motif Transformation Utilities

> **Source**: `src/motifs.js`
> **Status**: Feature Module
> **Dependencies**: None (uses global Math helpers only)

## Overview

`motifs.js` introduces a lightweight motif system for interval-based transformations and thematic development. A motif is represented as an ordered sequence of `{ note, duration }` events that can be transposed, inverted, augmented/diminished, reversed, or developed into new variants. Motifs can be applied to generated notes to imprint interval shapes onto composer output.

## Core API

### `new Motif(sequence, options)`
- `sequence`: Array of MIDI note numbers or `{ note, duration }` objects.
- `options.defaultDuration` (number, default `1`): Duration used when not provided per event.

### Properties
- `events` (getter): Deep-copied array of motif events.

### Transformation Methods
- `transpose(semitones)`: Returns a new motif shifted by `semitones` (clamped to MIDI 0-127).
- `invert(pivot)`: Reflects intervals around `pivot` (defaults to first note).
- `augment(factor)`: Multiplies durations by `factor` (safe minimum 1x).
- `diminish(factor)`: Divides durations by `factor` (safe minimum 1x).
- `reverse()`: Reverses event order.
- `develop({ transposeBy, invertPivot, reverse, scale })`: Convenience chain applying transpose → optional invert → optional reverse → optional scaling.

### Application Method
- `applyToNotes(notes, { clampMin, clampMax })`: Applies motif interval offsets to an array of `{ note }` objects (non-mutating). Offsets are measured relative to the motif's first note. Defaults clamp to MIDI `[0,127]`.

### Globals
- `activeMotif`: Current motif used by stage note generation (set by play.js per section type).
- `applyMotifToNotes(notes, motif?, options?)`: Helper that delegates to `motif.applyToNotes` if available.
- `clampMotifNote(val, min?, max?)`: MIDI-safe clamping utility.

## Integration Points

- **Stage**: `stage.playNotes()` / `stage.playNotes2()` call `applyMotifToNotes` when `activeMotif` is set, imprinting motif intervals onto generated notes before MIDI events are emitted.
- **Play**: Each section selects a section type profile; if the profile supplies a `motif` array (interval offsets), play.js instantiates `activeMotif` (rooted at MIDI 60) for that section.
- **Tests**: `test/motifs.test.js` validates transformations and application behavior.

## Usage Examples

```javascript
const motif = new Motif([60, 62, { note: 64, duration: 2 }]);
const inversion = motif.invert();          // Mirrors around first note
const retrograde = motif.reverse();        // Reverses order
const developed = motif.develop({          // Apply a chain
  transposeBy: 7,
  invertPivot: 60,
  reverse: true,
  scale: 2,
});
const applied = motif.applyToNotes([
  { note: 50 },
  { note: 52 },
  { note: 54 },
]);
```

## Design Notes
- Pure-functional transformations: methods return new Motif instances without mutating source sequences.
- MIDI-safe by default: clamping keeps results in 0-127 range.
- Lightweight: no external dependencies; suitable for real-time application inside the composition loop.
