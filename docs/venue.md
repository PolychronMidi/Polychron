<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# venue.ts - Music Theory & MIDI Reference Data

> **Status**: Music Theory Utilities  
> **Dependencies**: None (pure data/lookups)


## Overview

`venue.ts` provides music theory constants, MIDI data tables, and lookup functions for scales, chords, modes, and pitch mappings. It centralizes all music theory knowledge to avoid duplication and ensure consistency across composers.

**Core Responsibilities:**
- Define MIDI note/channel reference data and constants
- Provide scale degree and MIDI value lookup functions
- Export scale templates (major, minor, pentatonic, blues, modal)
- Export chord templates (major triads, seventh chords, extended harmonies)
- Export mode templates (Ionian through Locrian)
- Provide key-to-pitch conversion utilities

---

## API Highlights

### Data Exports

- `midiData` – MIDI note/octave reference table
- `allNotes` – Array of note names (C, C#, D, ...)
- `allScales` – Available scale types
- `allChords` – Available chord types
- `allModes` – Modal templates

### Lookup Functions

- `getMidiValue(type, name)` – Get MIDI value for note, chord, scale, mode, program
- `t(pitchClass, octave)` – Convert pitch class + octave to MIDI note

### Music Theory Data

Scales, chords, and modes defined as interval arrays and note offsets:

- Major, Minor, Pentatonic, Blues, Diminished, Augmented, Whole Tone
- Major, Minor, Dominant, Half-Diminished seventh chords
- Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian modes

---

## Usage Example

```typescript
import { getMidiValue, t, allScales } from '../src/venue';

// Get MIDI note value
const c4 = t('C', 4);        // 60
const cSharp = getMidiValue('note', 'C#');

// Get chord
const cmajor = getMidiValue('chord', 'major');

// Get scale degrees
const cMajorScale = getMidiValue('scale', 'major');
```

---

## Related Modules

- composers/ ([code](../src/composers/)) ([doc](composers.md)) - Use venue data for note selection
- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - References instruments/programs
- backstage.ts ([code](../src/backstage.ts)) ([doc](backstage.md)) - Re-exports venue helpers globally
