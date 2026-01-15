# **venue.js** ([code](../src/venue.js)) ([doc](venue.md)) - MIDI Specifications and Music Theory Constants

> **Source**: `src/venue.js`
> **Status**: Core Module - Data Reference
> **Dependencies**: tonal (music theory library)

## Overview

****venue.js** ([code](../src/venue.js)) ([doc](venue.md))** ([code](../src/venue.js ([code](../src/venue.js)) ([doc](venue.md)))) ([doc](venue.md)) is the **music theory and MIDI database** for Polychron. It provides comprehensive General MIDI data, music theory constants from Tonal.js, and lookup utilities for converting between human-readable names and MIDI numbers.

**Core Responsibilities:**
- **MIDI specification** - All 128 General MIDI instruments and control changes
- **Music theory data** - Scales, chords, modes, and notes from Tonal.js
- **Conversion utilities** - Name-to-number mapping for instruments and controls
- **Global databases** - Pre-computed arrays for random selection

## Architecture Role

****venue.js** ([code](../src/venue.js)) ([doc](venue.md))** ([code](../src/venue.js ([code](../src/venue.js)) ([doc](venue.md)))) ([doc](venue.md)) is the **data foundation**:
- **Imported by **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md))** to establish music theory constants
- **Used by **composers.js** ([code](../src/composers.js)) ([doc](composers.md))** for scale/chord/mode selection
- **Used by **stage.js** ([code](../src/stage.js)) ([doc](stage.md))** for instrument assignment and effects
- **No computational logic** - Pure data and simple lookup functions

---

## MIDI Specifications: `midiData`

Complete reference for all 128 MIDI programs and 128 control changes:

```javascript
midiData = {
  program: [
    { number: 0, name: 'Acoustic Grand Piano' },
    { number: 1, name: 'Bright Acoustic Piano' },
    // ... 128 total instruments
  ],
  control: [
    { number: 0, name: 'Bank Select (coarse)' },
    { number: 1, name: 'Modulation Wheel (coarse)' },
    // ... 128 total control changes
  ]
};
```

### Program Families (0-127)

| Range | Category | Examples |
|-------|----------|----------|
| 0-7 | Pianos | Acoustic Grand, Bright, Electric, Honky-tonk |
| 8-15 | Chromatic Percussion | Celesta, Glockenspiel, Music Box, Vibraphone |
| 16-23 | Organs | Hammond, Percussive, Rock, Church |
| 24-31 | Guitars | Acoustic, Nylon, Steel, Jazz, Clean, Muted, Overdriven |
| 32-39 | Bass | Acoustic, Electric (finger/pick), Fretless, Slap |
| 40-47 | Strings | Violin, Viola, Cello, Contrabass |
| 48-55 | Ensemble | String Ensemble, Slow String, Synth Strings |
| 56-63 | Brass | Trumpet, Trombone, Tuba, French Horn, Brass Section |
| 64-71 | Reeds | Soprano Sax, Alto Sax, Tenor Sax, Baritone Sax, Oboe, Clarinet |
| 72-79 | Pipes | Piccolo, Flute, Recorder, Pan Flute, Blown Bottle, Whistle, Ocarina |
| 80-87 | Synth Lead | Square, Sawtooth, Calliope, Chiff, Charang, Voice, Fifths, Bass & Lead |
| 88-95 | Synth Pad | New Age, Warm, Polysynth, Choir, Bowed, Metallic, Halo, Sweep |
| 96-103 | Synth Effects | FX Rain, Soundtrack, Crystal, Atmosphere, Brightness, Goblins, Echo |
| 104-111 | Ethnic | Sitar, Banjo, Shamisen, Koto, Kalimba, Bagpipe, Fiddle, Shanai |
| 112-119 | Percussive | Tinkle Bell, Agogo, Steel Drums, Woodblock, Taiko, Melodic Tom, Synth Drum |
| 120-127 | Sound Effects | Reverse Cymbal, Guitar Fret, Breath Noise, Seashore, Bird Tweet, Telephone |

### Control Change Categories

**Primary Controllers (0-31)**: Bank Select, Modulation Wheel, Breath Controller, Foot Pedal, Portamento Time, Data Entry, Volume, Balance, Pan Position, Expression, Effect Control 1&2, General Purpose 1-4

**Switch Controllers (64-95)**: Hold Pedal, Portamento, Sostenuto, Soft Pedal, Legato Footswitch, Hold 2, Sound Variation, Timbre/Harmonic Intensity, Release Time, Attack Time, Brightness, Decay Time, Vibrato Rate, Vibrato Depth, Vibrato Delay, Reverb Send Level, Tremolo Depth, Chorus Send Level, Delay/Echo Send Level, Phaser Send Level

**Channel Mode (120-127)**: All Sound Off, Reset All Controllers, Local On/Off, All Notes Off, Omni Mode, Poly/Mono Operation, System Exclusive

---

## Music Theory Constants: Tonal.js Integration

```javascript
t = require('tonal');
```

### All Notes: `allNotes`
Complete chromatic scale with 12 semitones:
```javascript
allNotes = t.Scale.get('C chromatic').notes.map(note =>
  t.Note.enharmonic(t.Note.get(note))
);
// Result: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
```
- **Uses enharmonic equivalents** for consistency
- **Used for random root note selection**

### All Scales: `allScales`
Comprehensive scale database from Tonal.js:
```javascript
allScales = t.Scale.names().filter(scaleName => {
  return allNotes.some(root => {
    const scale = t.Scale.get(`${root} ${scaleName}`);
    return scale.notes.length > 0;
  });
});
```

**Examples:**
- **Major/Minor**: C major, C minor, C harmonic minor, C melodic minor
- **Modes**: C ionian, C dorian, C phrygian, C lydian, C mixolydian, C aeolian, C locrian
- **Pentatonic**: C pentatonic major, C pentatonic minor
- **Blues**: C blues
- **Exotic**: C whole tone, C diminished, C altered, C augmented

### All Chords: `allChords`
Exhaustive chord symbol database:
```javascript
allChords = (function() {
  const allChords = new Set();
  t.ChordType.all().forEach(chordType => {
    allNotes.forEach(root => {
      const chord = t.Chord.get(`${root} ${chordType.name}`);
      if (!chord.empty && chord.symbol) {
        allChords.add(chord.symbol);
      }
    });
  });
  return Array.from(allChords);
})();
```

**Coverage:**
- **Triads**: Cmaj, Cmin, Cdim, Caug
- **Seventh chords**: Cmaj7, Cm7, Cdom7, Cm7b5
- **Extended chords**: C9, C11, C13, and variations
- **Altered chords**: C7#5, C7b9, C7b5, etc.
- **All root notes**: 12 × all chord types

### All Modes: `allModes`
Complete modal system:
```javascript
allModes = (() => {
  const allModes = new Set();
  t.Mode.all().forEach(mode => {
    allNotes.forEach(root => {
      allModes.add(`${root} ${mode.name}`);
    });
  });
  return Array.from(allModes);
})();
```

**Church Modes**: Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian (12 roots each)

**Jazz Modes**: Altered, Diminished, Whole Tone, and others from Tonal.js

---

## Lookup Utilities: `getMidiValue()`

Convert human-readable names to MIDI numbers:

```javascript
getMidiValue = (category, name) => {
  category = category.toLowerCase();
  name = name.toLowerCase();
  const item = midiData[category].find(item => 
    item.name.toLowerCase() === name
  );
  return item ? item.number : null;
};
```

**Usage:**
```javascript
getMidiValue('program', 'Acoustic Grand Piano')  // → 0
getMidiValue('program', 'glockenspiel')          // → 9
getMidiValue('control', 'Pan Position')          // → 10
```

**Features:**
- Case-insensitive matching
- Handles partial lookups via Tonal.js
- Returns null for invalid lookups
- Used by **sheet.js** ([code](../src/sheet.js)) ([doc](sheet.md)) to convert instrument names

---

## Data Structure Characteristics

### Performance
- **Pre-computed** - All data calculated once at load time
- **Array-based** - Fast iteration and random access
- **Zero runtime cost** - No calculations during composition

### Completeness
- **Full MIDI specification** - All 128 instruments and controls
- **Comprehensive music theory** - Every common scale, chord, mode combination
- **Professional accuracy** - Based on industry-standard Tonal.js

### Accessibility
- **Global scope** - All data directly accessible as constants
- **Simple structures** - Arrays and objects for straightforward use
- **Cross-module** - Used by **composers.js** ([code](../src/composers.js)) ([doc](composers.md)), **stage.js** ([code](../src/stage.js)) ([doc](stage.md)), **sheet.js** ([code](../src/sheet.js)) ([doc](sheet.md))

---

## Integration Examples

****composers.js** ([code](../src/composers.js)) ([doc](composers.md))** ([code](../src/composers.js ([code](../src/composers.js)) ([doc](composers.md)))) ([doc](composers.md)) - Random composition:
```javascript
const scale = allScales[ri(allScales.length - 1)];
const root = allNotes[ri(allNotes.length - 1)];
const notes = t.Scale.get(`${root} ${scale}`).notes;
```

****stage.js** ([code](../src/stage.js)) ([doc](stage.md))** ([code](../src/stage.js ([code](../src/stage.js)) ([doc](stage.md)))) ([doc](stage.md)) - Instrument assignment:
```javascript
const gmNumber = getMidiValue('program', 'Glockenspiel');
p(c, {tick: 0, type: 'program_c', vals: [channel, gmNumber]});
```

****sheet.js** ([code](../src/sheet.js)) ([doc](sheet.md))** ([code](../src/sheet.js ([code](../src/sheet.js)) ([doc](sheet.md)))) ([doc](sheet.md)) - Configuration to MIDI:
```javascript
primaryInstrument = getMidiValue('program', primaryInstrument);  // 'glockenspiel' → 9
```

---

## Design Philosophy

**"Complete Reference Library"** - Provides exhaustive music theory and MIDI data so other modules can:
- Generate sophisticated musical content without limitations
- Validate configurations against real MIDI/music theory
- Support both traditional and exotic compositions
- Never need external music theory lookups
