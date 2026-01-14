# venue.js - MIDI Data Specifications and Music Theory Constants

## Project Overview

**venue.js** serves as the **music theory and MIDI specification database** for the Polychron system. This file contains comprehensive MIDI program/control data, music theory constants generated from the Tonal.js library, and utility functions for converting between human-readable names and MIDI numbers.

## File Purpose

This module provides **complete music theory and MIDI reference data**:
- **MIDI Program definitions** - All 128 General MIDI instruments with names and numbers
- **MIDI Control definitions** - All standard MIDI Control Change messages
- **Music theory constants** - Complete scales, chords, modes, and notes from Tonal.js
- **Name-to-number conversion** - Utilities for translating instrument names to MIDI values
- **Global music databases** - Comprehensive arrays of all musical elements for random selection

## Architecture Role

**venue.js** operates as the **data foundation layer**:
- **Imported by backstage.js** to establish global constants
- **Provides reference data** used by composers.js for music theory operations
- **Supplies MIDI mappings** used by stage.js for instrument assignments
- **No computational logic** - Pure data definitions and simple lookup functions

## MIDI Specification Data

### `midiData` Object - Complete MIDI Reference
```javascript
midiData = {
  program: [
    { number: 0, name: 'Acoustic Grand Piano' },
    { number: 1, name: 'Bright Acoustic Piano' },
    // ... complete 128 instrument definitions
  ],
  control: [
    { number: 0, name: 'Bank Select (coarse)' },
    { number: 1, name: 'Modulation Wheel (coarse)' },
    // ... complete control change definitions
  ]
};
```

#### Program Array - General MIDI Instruments (0-127)
**Piano Family (0-7)**:
- Acoustic Grand Piano, Bright Acoustic Piano, Electric Grand Piano
- Honky-tonk Piano, Electric Piano 1&2, Harpsichord, Clavi

**Chromatic Percussion (8-15)**:
- Celesta, Glockenspiel, Music Box, Vibraphone
- Marimba, Xylophone, Tubular Bells, Dulcimer

**Organ Family (16-23)**, **Guitar Family (24-31)**, **Bass Family (32-39)**
**Orchestral Strings (40-47)**, **Ensemble Strings (48-55)**, **Brass Family (56-63)**
**Reed Family (64-71)**, **Pipe Family (72-79)**, **Synth Lead (80-87)**
**Synth Pad (88-95)**, **Synth Effects (96-103)**, **Ethnic Instruments (104-111)**
**Percussive Instruments (112-119)**, **Sound Effects (120-127)**

#### Control Array - MIDI Control Change Messages
**Primary Controllers (0-31)**: Bank Select, Modulation Wheel, Breath Controller, Foot Pedal, Volume, Balance, Pan Position, Expression

**Switch Controllers (64-95)**: Hold Pedal, Portamento, Sound controls, Effects controls

**Channel Mode (120-127)**: All Sound Off, All Controllers Off, All Notes Off, Omni Mode, Mono/Poly Operation

### `getMidiValue(category, name)` - Name-to-Number Conversion
```javascript
getMidiValue = (category, name) => {
  category = category.toLowerCase();
  name = name.toLowerCase();
  const item = midiData[category].find(item => item.name.toLowerCase() === name);
  return item ? item.number : null;
};
```

- **Case-insensitive matching** - Handles various capitalization patterns
- **Category validation** - Ensures valid MIDI data category
- **Error handling** - Returns null for invalid lookups with warning

## Music Theory Constants

### Tonal.js Integration
```javascript
t = require('tonal');
```
- **Professional music library** - Industry-standard music theory calculations
- **Comprehensive coverage** - Scales, chords, modes, intervals, progressions

### `allNotes` - Complete Chromatic Scale
```javascript
allNotes = t.Scale.get('C chromatic').notes.map(note =>
  t.Note.enharmonic(t.Note.get(note))
);
```
- **12-tone chromatic scale** - All semitones from C to B
- **Enharmonic equivalents** - Standardized note spellings (F# vs Gb)
- **Global note reference** - Used for random root note selection

### `allScales` - Comprehensive Scale Database
```javascript
allScales = t.Scale.names().filter(scaleName => {
  return allNotes.some(root => {
    const scale = t.Scale.get(`${root} ${scaleName}`);
    return scale.notes.length > 0;
  });
});
```
- **All available scales** - Every scale type in Tonal.js library
- **Validation filtering** - Only includes scales that produce valid note sets
- **Examples included**:
  - **Major/Minor scales** - Traditional Western scales
  - **Modal scales** - Dorian, Phrygian, Lydian, Mixolydian, etc.
  - **Exotic scales** - Pentatonic, Blues, Whole Tone, Diminished
  - **World music scales** - Arabic, Indian, Japanese, etc.

### `allChords` - Complete Chord Symbol Database
```javascript
allChords = (function() {
  function getChordNotes(chordType, root) {
    const chord = t.Chord.get(`${root} ${chordType}`);
    if (!chord.empty && chord.symbol) {
      return { symbol: chord.symbol, notes: chord.notes };
    }
  }
  const allChords = new Set();
  t.ChordType.all().forEach(chordType => {
    allNotes.forEach(root => {
      const chord = getChordNotes(chordType.name, root);
      if (chord) { allChords.add(chord.symbol); }
    });
  });
  return Array.from(allChords);
})();
```

- **Exhaustive chord generation** - Every chord type with every root note
- **Symbol-based storage** - Uses standard chord symbols (Cmaj7, Dm, G7, etc.)
- **Examples included**:
  - **Triads** - Major, minor, diminished, augmented
  - **Seventh chords** - Major 7, minor 7, dominant 7, half-diminished
  - **Extended chords** - 9th, 11th, 13th chords
  - **Altered chords** - Sharp/flat 5, sharp/flat 9, etc.

### `allModes` - Complete Modal Database
```javascript
allModes = (() => {
  const allModes = new Set();
  t.Mode.all().forEach(mode => {
    allNotes.forEach(root => {
      const modeName = `${root} ${mode.name}`;
      allModes.add(modeName);
    });
  });
  return Array.from(allModes);
})();
```

- **All modal combinations** - Every mode with every root note
- **String format** - "Root ModeName" format (e.g., "C ionian", "F# dorian")
- **Church modes** - Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian
- **Jazz modes** - Altered, Diminished, Whole Tone, etc.

## Data Structure Characteristics

### Performance Optimization
- **Pre-computed constants** - All data calculated once at load time
- **Array-based storage** - Fast iteration and random access
- **No runtime calculation** - Zero computational overhead during composition
- **Memory efficient** - Compact data structures optimized for lookup speed

### Comprehensive Coverage
- **Complete MIDI specification** - All 128 instruments and control changes
- **Exhaustive music theory** - Every common (and uncommon) musical element
- **Professional accuracy** - Based on industry-standard Tonal.js library

### Global Accessibility
- **No encapsulation** - All data directly accessible as global constants
- **Simple data structures** - Arrays and objects for straightforward access
- **Cross-module compatibility** - Used by composers.js, stage.js, and others

## Integration with Other Modules

### composers.js Dependencies
- **allNotes** - Used for random root note selection
- **allScales** - Used by RandomScaleComposer for scale selection
- **allChords** - Used by RandomChordComposer for chord progression generation
- **allModes** - Used by RandomModeComposer for modal harmony

### stage.js Dependencies
- **MIDI program numbers** - Used for instrument assignment
- **MIDI control numbers** - Used for effects and parameter control
- **Validated instrument names** - Ensures only valid MIDI instruments are used

### Configuration Integration
- **sheet.js instrument names** - Converted to MIDI numbers via getMidiValue()
- **Global constant assignment** - Makes instrument numbers available system-wide
- **Error validation** - Prevents invalid instrument configurations

## Usage Patterns

### Random Selection
```javascript
// Random scale selection
const randomScale = allScales[ri(allScales.length - 1)];

// Random chord selection
const randomChord = allChords[ri(allChords.length - 1)];

// Random mode selection
const randomMode = allModes[ri(allModes.length - 1)];
```

### Instrument Lookup
```javascript
// Convert instrument name to MIDI number
const pianoNumber = getMidiValue('program', 'Acoustic Grand Piano'); // Returns 0

// Convert control name to MIDI CC number
const volumeCC = getMidiValue('control', 'Volume (coarse)'); // Returns 7
```

### Music Theory Operations
```javascript
// Create scale from name
const scale = t.Scale.get('C major');

// Create chord from symbol
const chord = t.Chord.get('Cmaj7');

// Get mode notes
const mode = t.Mode.get('dorian');
const notes = t.Mode.notes(mode, 'D');
```

## Layer Architecture Independence

**venue.js** is **completely independent of LayerManager**:
- **Pure data module** - Contains only MIDI specifications and music theory constants
- **No state dependencies** - Doesn't reference global timing or layer variables
- **Universal reference** - Same MIDI/music theory data used by all layers
- **Load once, use everywhere** - Data computed at startup, accessed throughout composition
- **Zero layer awareness** - Functions like getMidiValue() work identically regardless of active layer

This stateless design makes venue.js the most reusable component in the system.

## Performance Characteristics

- **Load-time generation** - All data computed once when module loads
- **Zero runtime overhead** - No calculations during composition generation
- **Memory efficient** - Compact storage of comprehensive music data
- **Fast lookups** - Array and object access patterns optimized for speed
- **Global availability** - No parameter passing or module resolution overhead
