# sheet.js - Configuration and Musical Parameters

> **Source**: `src/sheet.js`
> **Status**: Core Module - Configuration
> **Dependencies**: None (config-only)

## Project Overview

**sheet.js** serves as the **configuration headquarters** for the entire Polychron system, defining all musical parameters, instrument assignments, structural settings, and system behaviors. This file acts as the "sheet music" of parameters that control every aspect of composition generation.

## File Purpose

This module provides **comprehensive system configuration** including:
- **Instrument definitions** - Primary, secondary, bass, and drum instrument specifications
- **Musical range parameters** - Meter, octave, voice, and subdivision constraints with probability weights
- **System settings** - Tuning frequency, binaural beat ranges, timing resolution, logging levels
- **Structural parameters** - Section counts, phrase lengths, composition organization
- **Composer configurations** - Which types of musical composers to use and their settings

## Architecture Role

**sheet.js** operates as the **configuration foundation**:
- **Imported first** by stage.js ([code](../src/stage.js)) ([doc](stage.md)), establishing all system parameters
- **No computational logic** - Pure parameter definitions and configuration data
- **User-customizable** - Primary interface for users to modify Polychron's behavior
- **Global parameter source** - All other modules reference these configuration values

## Instrument Configuration

### Primary Instrument Assignments
```javascript
primaryInstrument = 'glockenspiel';
secondaryInstrument = 'music box';
bassInstrument = 'Acoustic Bass';
bassInstrument2 = 'Synth Bass 2';
```

- **String-based specification** - Human-readable instrument names converted to MIDI numbers by venue.js
- **Primary instruments** - Main melodic content on center and source channels
- **Secondary instruments** - Reflection and echo processing channels
- **Bass separation** - Dedicated bass instruments for low-frequency content
- **Dual bass setup** - Two different bass timbres for variety

### Extended Instrument Arrays
```javascript
otherInstruments = [79,89,97,98,98,98,104,112,114,119,120,121,...Array.from({length: 6},(_, i) => i + 9)];
otherBassInstruments = [32,33,34,35,36,37,38,39,40,41,43,44,45,46,48,49,50,51,89,98,98,98,98,98,98,98,98,98,98];
drumSets = [0,8,16,24,25,32,40,48,127];
```

#### `otherInstruments` Analysis - Textural Variety
- **MIDI numbers decoded**:
  - **79** - Ocarina (ethnic)
  - **89** - Pad 2 (warm) - heavily weighted
  - **97** - FX 2 (soundtrack) - cinematic textures
  - **98** - FX 3 (crystal) - **dominant weight** (6 copies)
  - **104** - Sitar (ethnic)
  - **112** - Tinkle Bell (percussive)
  - **114** - Steel Drums (percussive)
  - **119** - Reverse Cymbal (effect)
  - **120-121** - Guitar Fret Noise, Breath Noise (sound effects)
- **Generated range** - Adds instruments 9-14 (Glockenspiel through Dulcimer)
- **Textural bias** - Favors ethereal, atmospheric, and exotic timbres

#### `drumSets` Analysis - Complete General MIDI drum sets
- **0** - Standard Kit, **8** - Room Kit, **16** - Power Kit, **24** - Electronic Kit
- **25** - Analog Kit, **32** - Jazz Kit, **40** - Brush Kit, **48** - Orchestra Kit, **127** - Reverse Kit

## System Configuration

### Audio System Parameters
```javascript
LOG = 'section,phrase,measure';
TUNING_FREQ = 432;
BINAURAL = {
  min: 8,
  max: 12
};
PPQ = 30000;
BPM = 72;
```

- **Selective logging** - Only section, phrase, and measure levels logged
- **432Hz tuning** - Alternative tuning frequency (vs standard 440Hz)
- **Binaural range** - 8-12Hz covers alpha brainwave frequencies
- **High resolution timing** - 30,000 ticks per quarter note for extreme precision
- **Base tempo** - 72 BPM starting point (subject to dynamic variation)

## Musical Range Parameters

All musical parameters use **weighted probability distributions** for sophisticated randomization:

### `NUMERATOR` - Time Signature Beat Count
```javascript
NUMERATOR = {
  min: 2,
  max: 11,
  weights: [10,20,30,40,20,10,5,1]
};
```
- **Range** - 2 to 11 beats per measure
- **Weight distribution** - Heavily favors 4-6 beats (weights 30-40), tapering toward extremes
- **Creates meters like** - 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, etc.

### `DENOMINATOR` - Time Signature Note Value
```javascript
DENOMINATOR = {
  min: 3,
  max: 11,
  weights: [10,20,30,40,20,10,5,1]
};
```
- **Non-standard denominators** - 3, 5, 7, 9, 11 (standard MIDI only supports powers of 2)
- **Enables exotic meters** - 4/5, 7/11, 3/7, etc. through meter spoofing system
- **Revolutionary capability** - Allows ANY time signature through MIDI conversion

### `OCTAVE` - Pitch Range Control
```javascript
OCTAVE = {
  min: 0,
  max: 8,
  weights: [11,27,33,35,33,35,30,7,3]
};
```
- **9-octave range** - Complete MIDI note range (C0 to C8)
- **Peak at octaves 3-5** - Middle register emphasis (35, 33, 35 weights)
- **Secondary peak at octave 1** - Low register for bass content
- **Musical optimization** - Favors most musical and audible octave ranges

### `VOICES` - Polyphonic Density
```javascript
VOICES = {
  min: 0,
  max: 7,
  weights: [15,30,25,7,4,3,2,1]
};
```
- **Heavily weighted toward monophony/simple polyphony**:
  - **0 voices** - 15 weight (silence/rests)
  - **1 voice** - 30 weight (monophonic lines)
  - **2 voices** - 25 weight (simple harmony)
  - **3+ voices** - Exponentially decreasing (7,4,3,2,1)
- **Prevents harmonic mud** - Limits complex chord clusters

## Structural Parameters

### Section and Phrase Organization
```javascript
PHRASES_PER_SECTION = {
  min: 2,
  max: 4
};
SECTIONS = {
  min: 6,
  max: 9
};
```
- **Phrase structure** - 2-4 phrases per section creates manageable formal units
- **Overall form** - 6-9 sections creates substantial compositions (typically 15-45 minutes)
- **Mathematical implications** - 12-36 total phrases, hundreds to thousands of measures
#### Section Types (new)
```
SECTION_TYPES = [
  { type: 'intro', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.9, dynamics: 'pp', motif: [0,2,4,7] },
  { type: 'exposition', weight: 3, phrases: { min: 2, max: 3 }, bpmScale: 1.0, dynamics: 'mf', motif: [0,4,7,12] },
  { type: 'development', weight: 2, phrases: { min: 3, max: 4 }, bpmScale: 1.05, dynamics: 'f', motif: [0,3,5,8,10] },
  { type: 'conclusion', weight: 2, phrases: { min: 1, max: 2 }, bpmScale: 0.95, dynamics: 'p', motif: [0,5,7,12] },
  { type: 'coda', weight: 1, phrases: { min: 1, max: 1 }, bpmScale: 0.9, dynamics: 'pp', motif: [0,7,12] }
];
```
- **Weighted selection**: `selectSectionType()` uses weights to bias form planning.
- **Per-section shaping**: Each profile provides phrase ranges and BPM scaling hints.
- **Motif seeding**: Optional `motif` arrays (interval offsets) feed `activeMotif` in play.js to imprint shapes on generated notes.
### Rhythmic Complexity Parameters

#### `DIVISIONS` - Beat Subdivision Density
```javascript
DIVISIONS = {
  min: 0,
  max: 10,
  weights: [1,15,20,25,20,10,10,7,2,2,1]
};
```
- **Peak at 3-4 divisions** - Most common subdivision levels
- **Allows extreme complexity** - Up to 10 divisions per beat
- **Musical balance** - Simple rhythms common, complex rhythms possible

#### `SUBDIVISIONS` and `SUBSUBDIVS` - Deeper Rhythmic Layers
```javascript
SUBDIVISIONS = {
  min: 0,
  max: 10,
  weights: [5,10,20,15,20,10,20,4,2,1]
};
SUBSUBDIVS = {
  min: 0,
  max: 5,
  weights: [5,20,30,20,10,5]
};
```
- **Subdivision focus** - Peak at 2-4 subdivisions per division
- **Subsubdivision restraint** - Lower maximum (5) prevents excessive fragmentation
- **Hierarchical complexity** - Each level adds complexity while maintaining coherence

## Composer Configuration

### `COMPOSERS` Array - Musical Intelligence Selection
```javascript
COMPOSERS = [
  // { type: 'scale', name: 'major', root: 'C', return: 'new ScaleComposer(this.name,this.root)' },
  // { type: 'chords', progression: ['Cmaj7','Dm','G','Cmaj7'], return: 'new ChordComposer(this.progression)' },
  // { type: 'mode', name: 'ionian', root: 'C', return: 'new ModeComposer(this.name,this.root)' },
  { type: 'randomScale', return: 'new RandomScaleComposer()' },
  { type: 'randomChords', return: 'new RandomChordComposer()' },
  { type: 'randomMode', return: 'new RandomModeComposer()' }
];
```

#### Active Composers - Maximum Variety Configuration
- **RandomScaleComposer** - Constantly changing scales and roots
- **RandomChordComposer** - Dynamic chord progressions
- **RandomModeComposer** - Evolving modal harmonies
- **No fixed composers** - Commented out static composers for maximum harmonic variety

#### Commented Static Composers - Alternative Configurations
- **ScaleComposer** - Fixed scale (e.g., C major) for traditional harmony
- **ChordComposer** - Fixed chord progression for structured harmony
- **ModeComposer** - Fixed mode for modal consistency

### Final Parameters
```javascript
SILENT_OUTRO_SECONDS = 5;
```
- **Composition ending** - 5-second silence after final musical events
- **Professional presentation** - Clean ending for audio playback

## Parameter Interaction Effects

### Cross-Parameter Relationships
- **Meter complexity affects subdivision complexity** - Complex time signatures reduce rhythmic density
- **Octave range affects voice count** - Wider ranges support more voices without crowding
- **BPM variations scale subdivision parameters** - Higher tempos reduce subdivision likelihood

### Dynamic Parameter Scaling
Many parameters are modified by **BPM ratios** during composition:
- **`bpmRatio`** - Configured BPM ÷ Actual BPM
- **`bpmRatio2`** - Actual BPM ÷ Configured BPM
- **`bpmRatio3`** - Specialized ratio for drum pattern probability

## Integration with System

### Global Variable Creation
All parameters become global variables accessible throughout the system:
- **Direct access** - BPM, PPQ, TUNING_FREQ used directly by other modules
- **No parameter passing** - Eliminates function parameter overhead
- **Runtime modification** - Parameters can be changed during composition (though not recommended)

### Dependency Chain
**sheet.js** → **venue.js** → **backstage.js** → **other modules**
- **Configuration loaded first** - Establishes all system parameters
- **Instrument name conversion** - venue.js converts string names to MIDI numbers
- **Global state initialization** - backstage.js creates working variables from configuration

## Layer Architecture Independence

**sheet.js** configuration applies **globally across all layers**:
- **No layer-specific settings** - Same instruments, ranges, weights used for all layers
- **Meter parameters** - NUMERATOR/DENOMINATOR used by both primary and poly layers
- **Instrument assignments** - primaryInstrument, bassInstrument shared across layers
- **System constants** - PPQ, BPM, TUNING_FREQ, BINAURAL settings are universal
- **LayerManager uses defaults** - LM.register() creates layers with sheet.js parameters

This global configuration simplifies the system while enabling complex multi-layer compositions through context switching rather than duplication.

## Performance Characteristics

- **Zero computational overhead** - Pure data definitions with no processing
- **Single load time** - Configuration parsed once at system startup
- **Global accessibility** - No lookup or retrieval costs during composition
- **Memory efficient** - Simple variable storage with minimal overhead
- **User-friendly** - Single file contains all customizable system behaviors
