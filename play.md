# play.js - Main Composition Engine and Orchestrator

## Project Overview

**play.js** is the **heart and conductor** of the Polychron MIDI composition system - the main execution engine that orchestrates the entire musical generation process. This file contains the core composition loop that creates complex, polyrhythmic MIDI compositions with unlimited time signatures and dynamic musical structures.

## File Purpose

This is the **primary entry point** and **main execution file** for the entire Polychron project. When you run `node play.js`, this file executes the complete composition generation process from start to finish, coordinating all other system components to create a sophisticated MIDI composition saved as a CSV file.

## Architecture Role

**play.js** sits at the top of the architectural hierarchy, serving as the **composition conductor**. It imports and coordinates six specialized modules:
- `stage.js` - Core audio processing and effects
- `composers.js` - Musical content generation (scales, chords, modes)
- `rhythm.js` - Rhythmic pattern generation
- `time.js` - Timing calculations and meter management
- `backstage.js` - Utility functions and global variables
- `venue.js` - MIDI data definitions and musical constants

## Code Style Philosophy

The code follows a **"clean minimal"** philosophy with these design principles:

### Extreme Conciseness
- **No comments** - The code structure and naming should be self-documenting
- **No empty lines** - Every line contains functional code
- **Compact syntax** - Dense, efficient expressions over verbose constructs
- **Global scope preference** - Variables are global when possible for cleaner access patterns

### Direct Naming
- **Clear, direct names** that immediately convey purpose
- **Short abbreviations** where context makes meaning obvious (e.g., `ri` for randomInt)
- **Descriptive function names** that explain what they do (e.g., `setMeasureTiming`, `crossModulateRhythms`)

### Structural Clarity
- **Nested loop structure** mirrors the musical hierarchy (sections > phrases > measures > beats > divisions)
- **Sequential execution** - operations happen in logical musical order
- **Minimal abstraction** - direct code execution rather than over-engineered patterns

## Complete Function Analysis

### Line 1-2: System Initialization
```javascript
require('./stage');
setTuningAndInstruments();
```
- **Loads all dependencies** through the stage.js module chain
- **Initializes MIDI channels** and instrument assignments
- **Sets up 432Hz tuning** and binaural frequency offsets

### Line 3-4: Section Loop Setup
```javascript
totalSections=ri(SECTIONS.min,SECTIONS.max);
for (sectionIndex=0; sectionIndex < totalSections; sectionIndex++) {
```
- **Determines composition structure** - typically 6-9 major sections
- **Outer loop** controls the highest level of musical organization
- **Section-level** timing and structural decisions

### Line 5-6: Composer and Phrase Selection
```javascript
composer=ra(composers);
phrasesPerSection=ri(PHRASES_PER_SECTION.min,PHRASES_PER_SECTION.max);
```
- **Randomly selects a composer** (RandomScaleComposer, RandomChordComposer, or RandomModeComposer)
- **Determines phrase count** per section (typically 2-4 phrases)
- **Sets the harmonic/melodic framework** for the upcoming musical content

### Line 8-10: Phrase Processing Loop
```javascript
for (phraseIndex=0; phraseIndex < phrasesPerSection; phraseIndex++) {
 [numerator,denominator]=composer.getMeter();
 getMidiMeter(); getPolyrhythm(); logUnit('phrase');
```
- **Phrase loop** - handles the next level of musical organization
- **Gets time signature** from the selected composer (e.g., 7/11, 5/3, etc.)
- **Calculates MIDI-compatible meter** using meter spoofing technique
- **Determines polyrhythm relationships** between different time signatures
- **Logs timing information** for debugging and analysis

### Line 12-16: Primary Measure Generation
```javascript
measuresPerPhrase=measuresPerPhrase1;
for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) { measureCount++;
 setMeasureTiming(); logUnit('measure'); beatRhythm=setRhythm('beat');
 for (beatIndex=0; beatIndex < numerator; beatIndex++) {trackBeatRhythm();beatCount++;
```
- **First polyrhythm section** - uses the primary time signature
- **Measure-level timing** calculations and rhythm pattern setup
- **Beat loop** iterates through each beat in the measure (numerator = beats per measure)
- **Rhythm tracking** monitors which beats are active/inactive for crossmodulation

### Line 17-22: Beat-Level Audio Processing
```javascript
setBeatTiming(); logUnit('beat'); divRhythm=setRhythm('div');
setOtherInstruments(); setBinaural(); setBalanceAndFX(); playDrums();
stutterFX(flipBin ? flipBinT3 : flipBinF3);
stutterFade(flipBin ? flipBinT3 : flipBinF3);
rf()<.05 ? stutterPan(flipBin ? flipBinT3 : flipBinF3) : stutterPan(stutterPanCHs);
```
- **Beat timing calculations** - when each beat occurs in absolute time
- **Complete audio processing chain**:
  - **Instrument selection** and channel assignment
  - **Binaural beat frequency shifts** for psychoacoustic effects
  - **Balance, panning, and effects** processing
  - **Drum pattern generation** with sophisticated algorithms
  - **Stutter effects** (volume, panning, FX modulation)

### Line 23-30: Division and Subdivision Processing
```javascript
for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
 setDivTiming(); logUnit('division'); subdivRhythm=setRhythm('subdiv');
 for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) {
  setSubdivTiming(); logUnit('subdivision'); playNotes(); }
 for (subsubdivIndex=0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) {
  setSubsubdivTiming(); logUnit('subsubdivision'); playNotes2(); }
```
- **Division loop** - rhythmic subdivisions within each beat (typically 0-10 divisions)
- **Subdivision loop** - further subdivisions within each division (0-10 subdivisions)
- **Subsubdivision loop** - finest level of rhythmic detail (0-5 subsubdivisions)
- **Note generation** - `playNotes()` and `playNotes2()` create the actual musical content
- **Hierarchical rhythm tracking** - monitors active/inactive states at each level

### Line 32-44: Polyrhythm Section (Secondary Meter)
```javascript
beatRhythm=divRhythm=subdivRhythm=0;
numerator=polyNumerator; meterRatio=polyMeterRatio;
measuresPerPhrase=measuresPerPhrase2;
for (measureIndex=0; measureIndex < measuresPerPhrase; measureIndex++) {
 setMeasureTiming(); logUnit('measure'); beatRhythm=setRhythm('beat');
 for (beatIndex=0; beatIndex < numerator; beatIndex++) { trackBeatRhythm();
  setBeatTiming(); logUnit('beat'); divRhythm=setRhythm('div'); playDrums2();
  for (divIndex=0; divIndex < divsPerBeat; divIndex++) { trackDivRhythm();
   setDivTiming(); logUnit('division'); subdivRhythm=setRhythm('subdiv');
   for (subdivIndex=0; subdivIndex < subdivsPerDiv; subdivIndex++) {
    setSubdivTiming(); logUnit('subdivision'); playNotes(); }
   for (subsubdivIndex=0; subsubdivIndex < subdivsPerSub; subsubdivIndex++) {
    setSubsubdivTiming(); logUnit('subsubdivision'); playNotes2(); }
```
- **Rhythm reset** - clears previous patterns for clean polyrhythmic transition
- **Switches to polyrhythm meter** - uses the secondary time signature calculated earlier
- **Second measure loop** - generates content in the polyrhythmic meter
- **Simplified processing** - fewer effects, focus on rhythmic interplay
- **playDrums2()** - different drum patterns for polyrhythmic sections

### Line 46-51: Section and Phrase Transitions
```javascript
nextPhrase();
}
logUnit('section'); nextSection();
}
grandFinale();
```
- **nextPhrase()** - advances timing counters and prepares for next phrase
- **Section logging and advancement** - records section completion and timing
- **grandFinale()** - finalizes the composition, writes CSV file, and calculates duration

## Musical Structure Hierarchy

The nested loop structure directly mirrors musical organization:

1. **Composition** (entire piece)
2. **Sections** (6-9 major parts)
3. **Phrases** (2-4 per section)
4. **Measures** (varies based on polyrhythm calculations)
5. **Beats** (varies based on time signature numerator)
6. **Divisions** (0-10 per beat)
7. **Subdivisions** (0-10 per division)
8. **Subsubdivisions** (0-5 per subdivision)

This creates compositions with **millions of discrete timing points**, enabling unprecedented rhythmic complexity while maintaining musical coherence through the hierarchical organization.

## Polyrhythmic Innovation

**play.js** implements a sophisticated **dual-meter system**:

### Primary Meter Section (Lines 12-30)
- Uses the **original time signature** generated by the composer
- **Full audio processing** - complete effects chain, binaural beats, stutter effects
- **Complete subdivision hierarchy** - all 7 levels of rhythmic detail
- **Primary musical content** - main melodic and harmonic material

### Polyrhythmic Meter Section (Lines 32-44)
- Uses a **mathematically compatible secondary meter** calculated by getPolyrhythm()
- **Simplified processing** - reduced effects to highlight rhythmic relationships
- **Same subdivision structure** - maintains rhythmic complexity in new meter
- **Complementary content** - musical material that interlocks with primary section

### Mathematical Relationship
Both sections have **identical duration** but different **internal subdivisions**, creating complex **polyrhythmic relationships** that would be impossible for human performers but are mathematically precise in the MIDI domain.

## Performance Characteristics

- **Execution time**: Several seconds to generate complete compositions
- **Output size**: CSV files typically 50MB-200MB with hundreds of thousands of MIDI events
- **Musical duration**: Typically 15-45 minutes of composed music
- **Complexity**: Impossible for humans to perform due to polyrhythmic density and timing precision
- **Compatibility**: Standard MIDI playback through CSV-to-MIDI conversion

## Integration Points

**play.js** orchestrates but does not contain the implementation details for:
- **Musical content generation** (handled by composers.js classes)
- **Rhythmic pattern creation** (handled by rhythm.js algorithms)
- **Timing calculations** (handled by time.js functions)
- **Audio processing** (handled by stage.js effects chain)
- **Utility functions** (handled by backstage.js helpers)
- **MIDI specifications** (handled by venue.js data structures)

This separation allows **play.js** to focus purely on **composition orchestration** while delegating specialized tasks to appropriate modules.

## Revolutionary Aspects

### Meter Freedom
**play.js** enables composition in **any time signature** through the meter spoofing system, breaking free from MIDI's traditional limitations.

### Polyrhythmic Precision
The dual-meter system creates **mathematically perfect polyrhythms** that maintain temporal relationships impossible to achieve through traditional composition methods.

### Hierarchical Complexity
The **7-level timing hierarchy** (section through subsubdivision) creates unprecedented rhythmic detail while maintaining musical structure.

### Psychoacoustic Integration
**Binaural beat generation** and **spatial audio processing** add neuroscientific dimensions to the musical experience.

### Human-Impossible Performance
The resulting compositions are **intentionally unplayable by humans**, exploring musical territories only accessible through algorithmic composition and computer performance.

## LayerManager Context Switching Architecture

### Dual-Layer Polyrhythmic System
**play.js** now uses LayerManager (LM) to maintain separate timing contexts for each layer:
- **Primary layer** - First meter with full audio processing
- **Poly layer** - Second meter with complementary content
- Each layer has independent tick rates but synchronized absolute time

### Context Switching Pattern
```
LM.register('primary', c1, {}, setupFn)  // Create layer with initial state
LM.activate('primary')                   // Restore layer's timing globals
  [process with shared globals]          // Composition functions use global variables
LM.advance('primary', 'phrase')          // Save globals back, advance phraseStart
```

### Timing State Management
Each layer maintains private state:
- `phraseStart`, `phraseStartTime` - Phrase boundary positions
- `measureStart`, `measureStartTime` - Current measure positions
- `tpMeasure`, `spMeasure` - Ticks/seconds per measure (layer-specific)
- `tpPhrase`, `spPhrase` - Ticks/seconds per phrase
- `numerator`, `denominator` - Current meter
- `tpSec` - Ticks per second (tempo-adjusted)

### Why Context Switching?
- **Enables polyrhythm** - Different layers can have different tick rates
- **Maintains sync** - Phrase boundaries align in absolute time (seconds)
- **Simplifies code** - Composition functions use clean global variable access
- **Scalable** - Easy to add more layers without refactoring

## Timing Increment Hierarchy

### Cascading Position Calculations
Each timing level builds on its parent:

```
Section:        sectionStart += tpSection (accumulated phrases)
Phrase:         phraseStart += tpPhrase (in LM.advance)
Measure:        measureStart = phraseStart + measureIndex × tpMeasure
Beat:           beatStart = phraseStart + measureIndex × tpMeasure + beatIndex × tpBeat
Division:       divStart = beatStart + divIndex × tpDiv
Subdivision:    subdivStart = divStart + subdivIndex × tpSubdiv
Subsubdivision: subsubdivStart = subdivStart + subsubdivIndex × tpSubsubdiv
```

### Loop Structure with Timing Increments

```javascript
for section
  for phrase
    LM.activate(layer)              // Restore: phraseStart, tpMeasure, etc.
    setUnitTiming('phrase')         // Calculate: tpPhrase, spPhrase

    for measure (measureIndex)
      setUnitTiming('measure')      // measureStart = phraseStart + measureIndex×tpMeasure

      for beat (beatIndex)
        setUnitTiming('beat')       // beatStart = phraseStart + measureIndex×tpMeasure + beatIndex×tpBeat
        [composition functions]     // Use beatStart for MIDI tick positions

        for div (divIndex)
          setUnitTiming('division') // divStart = beatStart + divIndex×tpDiv

          for subdiv (subdivIndex)
            setUnitTiming('subdivision')   // subdivStart = divStart + subdivIndex×tpSubdiv
            playNotes()             // Uses subdivStart for note timing

          for subsubdiv (subsubdivIndex)
            setUnitTiming('subsubdivision') // subsubdivStart = subdivStart + subsubdivIndex×tpSubsubdiv
            playNotes2()            // Uses subsubdivStart for note timing

    LM.advance('phrase')            // Save state, phraseStart += tpPhrase
```

### Delicate Dependencies
Each calculation requires:
1. **Parent position** (`phraseStart` from layer.state or previous calculation)
2. **Loop index** (`measureIndex`, `beatIndex`, etc. from play.js loops)
3. **Duration multiplier** (`tpMeasure`, `tpBeat`, etc. from setUnitTiming calculations)

### Meter Spoofing Synchronization
Different layers have different tick rates but same absolute time:
- **Primary layer**: e.g., 480 tpMeasure in 4/4
- **Poly layer**: e.g., 360 tpMeasure in 3/4
- **Both layers**: Same spPhrase (seconds per phrase)
- **Result**: Phrase boundaries align perfectly in time despite different tick counts

This is the core of **meter spoofing** - enabling any time signature while maintaining MIDI compatibility and cross-layer synchronization.
