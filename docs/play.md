# play.js - Main Composition Engine and Orchestrator

> **Source**: `src/play.js`
> **Status**: Core Module
> **Dependencies**: stage.js ([code](../src/stage.js)) ([doc](stage.md)), composers.js ([code](../src/composers.js)) ([doc](composers.md)), rhythm.js ([code](../src/rhythm.js)) ([doc](rhythm.md)), time.js ([code](../src/time.js)) ([doc](time.md)), backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)), venue.js ([code](../src/venue.js)) ([doc](venue.md))

## Project Overview

**play.js** is the **heart and conductor** of the Polychron MIDI composition system - the main execution engine that orchestrates the entire musical generation process. This file contains the core composition loop that creates complex, polyrhythmic MIDI compositions with unlimited time signatures and dynamic musical structures through a dual-layer architecture.

## File Purpose

This is the **primary entry point** and **main execution file** for the entire Polychron project. When you run `node src/play`, this file executes the complete composition generation process from start to finish, orchestrating two independent musical layers (primary and poly) with perfect timing synchronization in absolute time.

The system generates:
- **Primary layer** - Full composition in the initial time signature
- **Poly layer** - Independent simultaneous composition in a derived polyrhythmic meter
- **Perfect alignment** - Both layers complete in synchronized time through phrase-level advancement

## Architecture Role

**play.js** sits at the top of the architectural hierarchy, serving as the **composition conductor**:
- **Loads stage.js** ([code](../src/stage.js)) ([doc](stage.md)) - Initializes all dependencies through the module chain
- **Coordinates all modules** - Calls functions from composers.js ([code](../src/composers.js)) ([doc](composers.md)), rhythm.js ([code](../src/rhythm.js)) ([doc](rhythm.md)), time.js ([code](../src/time.js)) ([doc](time.md))
- **Manages layer contexts** - Registers, activates, and advances both primary and poly layers
- **Controls hierarchy** - Manages section → phrase → measure → beat → division → subdivision → subsubdivision nesting

## Code Architecture

### Dual-Layer Polyrhythmic System
**play.js** implements a revolutionary dual-layer composition architecture:
- **Primary layer** - Initial time signature with full audio processing
- **Poly layer** - Polyrhythmic secondary meter with synchronized timing
- **Synchronized boundaries** - Both layers complete phrases at exactly the same absolute time

### LayerManager Context Switching
Uses LayerManager (LM) from time.js ([code](../src/time.js)) ([doc](time.md)) to maintain independent timing contexts:

```javascript
const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, setTuningAndInstruments);
const { state: poly, buffer: c2 } = LM.register('poly', 'c2', {}, setTuningAndInstruments);
```

Each layer maintains private state:
- `phraseStart`, `phraseStartTime` - Phrase boundary positions
- `numerator`, `denominator` - Current meter for this layer
- `tpMeasure`, `spMeasure` - Ticks/seconds per measure (layer-specific)
- `tpSec` - Ticks per second (tempo-adjusted based on meter spoofing)

### Why Context Switching?
- **Different tick rates** - Layers have different tpMeasure for different meters
- **Synchronized time** - Phrase boundaries align in absolute seconds despite different tick counts
- **Clean code** - Composition functions use shared global variables, LM switches context between layers
- **Scalable** - Easy to extend with additional layers

## Execution Flow

### 1. Initialization
```javascript
require('./stage');  // Loads all dependencies
```
- Imports stage.js ([code](../src/stage.js)) ([doc](stage.md)) which transitively loads all other modules
- Both layers registered with LayerManager and initialized

### 2. Section Loop (Outer Structure)
```javascript
totalSections = ri(SECTIONS.min, SECTIONS.max);
for (sectionIndex = 0; sectionIndex < totalSections; sectionIndex++) { ... }
```
- **Determines composition structure** - typically 3-5 major sections
- **Outer loop** controls highest level of musical organization

### 3. Phrase Loop (Per Section)
```javascript
phrasesPerSection = ri(PHRASES_PER_SECTION.min, PHRASES_PER_SECTION.max);
for (phraseIndex = 0; phraseIndex < phrasesPerSection; phraseIndex++) {
  composer = ra(composers);
  [numerator, denominator] = composer.getMeter();  // Get time signature from composers.js
  getMidiTiming();           // Calculate MIDI-compatible meter via meter spoofing
  getPolyrhythm();          // Find optimal polyrhythm alignment
```
- **Randomly selects composer** from composers.js ([code](../src/composers.js)) ([doc](composers.md))
- **Gets time signature** - any arbitrary ratio (7/11, 5/13, etc.)
- **Calculates meter spoofing** via time.js ([code](../src/time.js)) ([doc](time.md))
- **Determines polyrhythm** - how primary and poly meters align

### 4. Primary Layer (Line 19-45)
```javascript
LM.activate('primary', false);  // Restore primary layer's timing context
setUnitTiming('phrase');
for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
  measureCount++;
  setUnitTiming('measure');

  for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
    beatCount++;
    setUnitTiming('beat');
    setOtherInstruments();  // From stage.js - instrument management
    setBinaural();          // From stage.js - psychoacoustic effects
    setBalanceAndFX();      // From stage.js - spatial audio
    playDrums();            // From stage.js - drum pattern generation
    stutterFX(...);         // From stage.js - effects modulation
    stutterFade(...);       // From stage.js - volume variation
    stutterPan(...);        // From stage.js - panning variation

    for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
      setUnitTiming('division');

      for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
        setUnitTiming('subdivision');
        playNotes();        // Generate primary layer notes
      }

      for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
        setUnitTiming('subsubdivision');
        playNotes2();       // Generate primary layer secondary notes
      }
    }
  }
}
```

**Processing chain for each beat**:
1. **setUnitTiming()** from time.js ([code](../src/time.js)) ([doc](time.md)) - Calculate tick positions
2. **setOtherInstruments()** from stage.js ([code](../src/stage.js)) ([doc](stage.md)) - Select instruments
3. **setBinaural()** from stage.js ([code](../src/stage.js)) ([doc](stage.md)) - Alpha frequency shifts
4. **setBalanceAndFX()** from stage.js ([code](../src/stage.js)) ([doc](stage.md)) - Panning/effects
5. **playDrums()** from stage.js ([code](../src/stage.js)) ([doc](stage.md)) - Drum patterns
6. **stutterFX/stutterFade/stutterPan()** from stage.js ([code](../src/stage.js)) ([doc](stage.md)) - Audio effects
7. **playNotes()/playNotes2()** - Generate musical content via composers.js ([code](../src/composers.js)) ([doc](composers.md))

**Hierarchical timing**:
- Division loop - 0-10 subdivisions per beat
- Subdivision loop - 0-10 subdivisions per division
- Subsubdivision loop - 0-5 finest detail level
- Creates millions of discrete timing points for extreme rhythmic complexity

### 5. Layer Advancement
```javascript
LM.advance('primary', 'phrase');  // Save primary's state, advance phraseStart
```
- Saves all timing globals back to layer's private state
- Advances `phraseStart` by one phrase duration
- Ready for next phrase or next section

### 6. Poly Layer (Line 47-93)
```javascript
LM.activate('poly', true);  // Restore poly layer's timing context
getMidiTiming();
setUnitTiming('phrase');
for (measureIndex = 0; measureIndex < measuresPerPhrase; measureIndex++) {
  setUnitTiming('measure');

  for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
    setUnitTiming('beat');
    setOtherInstruments();
    setBinaural();
    setBalanceAndFX();
    playDrums2();           // Different drum patterns for poly layer
    stutterFX(...);
    stutterFade(...);
    stutterPan(...);

    for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
      setUnitTiming('division');

      for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
        setUnitTiming('subdivision');
        playNotes();
      }

      for (subsubdivIndex = 0; subsubdivIndex < subsubsPerSub; subsubdivIndex++) {
        setUnitTiming('subsubdivision');
        playNotes2();
      }
    }
  }
}

LM.advance('poly', 'phrase');  // Save poly's state, advance its phraseStart
```

**Identical structure to primary layer but**:
- Uses **poly layer's timing context** - different tpMeasure for different meter
- Uses **playDrums2()** - alternative drum patterns for rhythmic variety
- Same **hierarchical subdivision complexity**
- **Mathematically perfectly synchronized** with primary layer - phrase boundaries occur at identical absolute times

### 7. Section and Composition Completion
```javascript
LM.advance('primary', 'section');
logUnit('section');
LM.advance('poly', 'section');
logUnit('section');
}  // End of phrase loop

}  // End of section loop

grandFinale();  // From writer.js - finalize and write output files
```

## Hierarchical Timing Structure

All timing calculations cascade from parent levels:

```
setUnitTiming('phrase')      // Calculate: tpPhrase, spPhrase from numerator/denominator
setUnitTiming('measure')     // measureStart = phraseStart + measureIndex × tpMeasure
setUnitTiming('beat')        // beatStart = phraseStart + measureIndex × tpMeasure + beatIndex × tpBeat
setUnitTiming('division')    // divStart = beatStart + divIndex × tpDiv
setUnitTiming('subdivision') // subdivStart = divStart + subdivIndex × tpSubdiv
setUnitTiming('subsubdiv')   // subsubdivStart = subdivStart + subsubdivIndex × tpSubsubdiv
```

Each level provides input for nested loops below it. All MIDI tick positions ultimately derive from these calculations.

## Module Dependencies

### Loaded Via stage.js ([code](../src/stage.js)) ([doc](stage.md))
- backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)) - Utility functions and state
- writer.js ([code](../src/writer.js)) ([doc](writer.md)) - CSV output infrastructure
- sheet.js ([code](../src/sheet.js)) ([doc](sheet.md)) - Configuration parameters
- venue.js ([code](../src/venue.js)) ([doc](venue.md)) - MIDI constants
- rhythm.js ([code](../src/rhythm.js)) ([doc](rhythm.md)) - Drum pattern algorithms
- time.js ([code](../src/time.js)) ([doc](time.md)) - LayerManager and meter spoofing
- composers.js ([code](../src/composers.js)) ([doc](composers.md)) - Musical content generation

### Direct Usage
- composers.js ([code](../src/composers.js)) ([doc](composers.md)) - `.getMeter()` for time signatures
- time.js ([code](../src/time.js)) ([doc](time.md)) - LayerManager for context switching

## Revolutionary Capabilities

### Infinite Time Signatures
Through meter spoofing in time.js ([code](../src/time.js)) ([doc](time.md)), compose in **any** time signature including prime denominators and non-standard ratios.

### Mathematically Perfect Polyrhythms
Two independent layers with different meters but perfectly synchronized phrase boundaries in absolute time - impossible for human performers but precise in MIDI domain.

### Extreme Rhythmic Granularity
7-level hierarchical timing (section → phrase → measure → beat → division → subdivision → subsubdivision) creates millions of discrete musical events.

### Psychoacoustic Integration
Binaural beats, spatial audio, and dynamic effects processing add neuroscientific dimensions beyond traditional composition.

## Performance Characteristics

- **Execution time**: Several seconds to generate complete compositions
- **Output size**: CSV files typically 50MB-200MB
- **Musical duration**: Typically 15-45 minutes of composed music
- **Complexity**: Intentionally unplayable by humans due to polyrhythmic density
- **Precision**: MIDI tick-level accuracy with absolute time synchronization

This is the core of **meter spoofing** - enabling any time signature while maintaining MIDI compatibility and cross-layer synchronization.
