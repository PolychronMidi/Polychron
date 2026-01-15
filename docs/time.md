# time.js - Timing Engine and Temporal Management System

> **Source**: `src/time.js`
> **Status**: Core Module - Timing & Meter Spoofing
> **Dependencies**: backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)), writer.js ([code](../src/writer.js)) ([doc](writer.md))

## Project Overview

**time.js** is the **temporal brain** of the Polychron system, responsible for all timing calculations, meter management, and the revolutionary "meter spoofing" technology that enables any time signature to work within MIDI constraints. This file handles the complex mathematics of polyrhythmic relationships and maintains precise timing coordination across all musical hierarchical levels.

## File Purpose

This module provides **advanced timing capabilities** including:
- **Meter spoofing** - Converts any time signature (even 420/69) to MIDI-compatible equivalents
- **Polyrhythm calculation** - Finds mathematical relationships between different meters
- **Hierarchical timing** - Precise timing for sections, phrases, measures, beats, divisions, subdivisions, and subsubdivisions
- **MIDI timing conversion** - Converts musical time to MIDI tick values
- **Tempo scaling** - Dynamic BPM adjustments and ratio calculations
- **Timing transitions** - Smooth temporal evolution between musical sections

## Architecture Role

**time.js** operates as the **timing coordinator**, bridging musical concepts with MIDI technical requirements. It receives timing requests from **play.js** ([code](../src/play.js)) ([doc](play.md)) and provides precise temporal data to all other modules. The file integrates closely with:
- **play.js** ([code](../src/play.js)) ([doc](play.md)) - Receives timing advancement requests and provides structural timing data
- **composers.js** ([code](../src/composers.js)) ([doc](composers.md)) - Validates time signatures and provides meter compatibility checking
- **stage.js** ([code](../src/stage.js)) ([doc](stage.md)) - Supplies exact tick timing for MIDI event generation
- **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md)) - Uses utility functions for mathematical calculations

## Revolutionary Meter Spoofing System

### `getMidiMeter()` - The Core Innovation
```javascript
getMidiMeter = () => {
  meterRatio = numerator / denominator;
  isPowerOf2 = (n) => { return (n & (n - 1)) === 0; }
  if (isPowerOf2(denominator)) {
    midiMeter = [numerator, denominator];
  } else {
    const high = 2 ** m.ceil(m.log2(denominator));
    const highRatio = numerator / high;
    const low = 2 ** m.floor(m.log2(denominator));
    const lowRatio = numerator / low;
    midiMeter = m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio) ?
      [numerator, high] : [numerator, low];
  }
  midiMeterRatio = midiMeter[0] / midiMeter[1];
  syncFactor = midiMeterRatio / meterRatio;
  midiBPM = BPM * syncFactor;
  tpSec = midiBPM * PPQ / 60;
  tpMeasure = PPQ * 4 * midiMeterRatio;
  setMidiTiming();
};
```

**Revolutionary Capability**: Enables **ANY** time signature to work in MIDI:
- **7/11 time** - Converts to nearest power-of-2 denominator (7/8 or 7/16)
- **420/69 time** - Finds mathematically optimal MIDI representation
- **Prime denominators** - Handles 7, 11, 13, 17, 19, 23, etc.

#### Algorithm Steps:
1. **Calculate actual meter ratio** (numerator ÷ denominator)
2. **Check if denominator is power of 2** - If yes, use directly (MIDI native)
3. **If not power of 2**:
   - Find **next higher** power of 2 (2^ceil(log₂(denominator)))
   - Find **next lower** power of 2 (2^floor(log₂(denominator)))
   - Calculate **ratio differences** for both options
   - **Choose closest match** to preserve musical feel
4. **Calculate sync factor** - Ratio between MIDI meter and actual meter
5. **Adjust BPM** - Scales tempo to maintain proper note durations
6. **Set MIDI timing** - Writes tempo and meter changes to CSV

### `getPolyrhythm()` - Mathematical Polyrhythm Discovery
```javascript
getPolyrhythm = () => {
  while (true) {
    [polyNumerator, polyDenominator] = composer.getMeter(true, true);
    polyMeterRatio = polyNumerator / polyDenominator;
    let allMatches = [];
    let bestMatch = {
      originalMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity
    };

    for (let originalMeasures = 1; originalMeasures < 6; originalMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 6; polyMeasures++) {
        if (m.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
          let currentMatch = {
            originalMeasures: originalMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: originalMeasures + polyMeasures
          };
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }
  }
};
```

**Finds mathematically perfect polyrhythmic relationships**:
- **Precise mathematical matching** - Uses floating-point epsilon for equality (0.00000001)
- **Duration equivalence** - Ensures both meters complete at same time point
- **Optimal solution finding** - Chooses shortest total duration for musical practicality

## Hierarchical Timing Functions

### `setBeatTiming()` - Beat-Level Processing
```javascript
setBeatTiming = () => {
  tpBeat = tpMeasure / numerator;
  spBeat = tpBeat / tpSec;
  trueBPM = 60 / spBeat;
  bpmRatio = BPM / trueBPM;
  bpmRatio2 = trueBPM / BPM;
  trueBPM2 = numerator * (numerator / denominator) / 4;
  bpmRatio3 = 1/trueBPM2;
  beatStart = phraseStart + measureIndex * tpMeasure + beatIndex * tpBeat;
  beatStartTime = measureStartTime + beatIndex * spBeat;
  divsPerBeat = composer.getDivisions();
};
```

- **Beat subdivision** - Divides measure time by beat count (numerator)
- **Multiple BPM ratios** for different musical decisions
- **Absolute beat positioning** - Precise tick timing for each beat

### `logUnit(type)` - Comprehensive Timing Documentation
```javascript
logUnit = (type) => {
  let shouldLog = false;
  type = type.toLowerCase();
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else {
    const logList = LOG.split(',').map(item => item.trim());
    shouldLog = logList.includes(type);
  }
  if (!shouldLog) return null;

  return (() => { c.push({
    tick: startTick,
    type: 'marker_t',
    vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) ${meterInfo ? meterInfo : ''}`]
  }); })();
};
```

**Creates detailed timing documentation**:
- **Configurable logging** - LOG setting controls detail level
- **CSV marker generation** - Creates MIDI text events for real-time tracking
- **Human-readable time display** - Minutes:seconds format with high precision

## Performance Characteristics

- **Mathematical precision** - High-precision floating-point calculations
- **Efficient algorithms** - Optimized for real-time calculation
- **MIDI-optimized** - All output directly compatible with MIDI timing requirements
- **Scalable complexity** - Handles simple 4/4 time through complex polyrhythmic structures

## setUnitTiming() - Universal Timing Calculator

### Purpose
Central timing function called at every hierarchical level (phrase → measure → beat → division → subdivision → subsubdivision). Calculates absolute tick/time positions using cascading parent position calculations.

### Architecture Integration
- Called from `play.js` nested loops at each timing level
- Uses `LM.layers[LM.activeLayer].state` for anchor positions
- Updates global timing variables used by composition functions
- Implements the delicate cascading increment pattern

### Timing Increment Hierarchy

Each level calculates position from parent position + index × duration:

#### Phrase Level
```javascript
tpPhrase = tpMeasure × measuresPerPhrase;  // Total ticks in phrase (layer-specific)
spPhrase = tpPhrase / tpSec;               // Total seconds in phrase (synchronized)
```
- **Anchor**: N/A (top of hierarchy)
- **Duration source**: Calculated from measure count
- **Synchronization boundary**: spPhrase is identical across layers

#### Measure Level
```javascript
measureStart = layer.state.phraseStart + measureIndex × tpMeasure;
measureStartTime = layer.state.phraseStartTime + measureIndex × spMeasure;
```
- **Anchor**: `phraseStart` from layer.state (set by LM.activate or LM.advance)
- **Index**: `measureIndex` from play.js measure loop
- **Duration**: `tpMeasure` (layer-specific, varies by meter)
- **Formula**: `phraseStart + measureIndex × tpMeasure`

#### Beat Level
```javascript
tpBeat = tpMeasure / numerator;
beatStart = phraseStart + measureIndex × tpMeasure + beatIndex × tpBeat;
beatStartTime = measureStartTime + beatIndex × spBeat;
```
- **Anchor**: `phraseStart` (cascades through measureIndex calculation)
- **Indices**: `measureIndex`, `beatIndex` from play.js loops
- **Duration**: `tpBeat` calculated from measure/numerator
- **Formula**: `phraseStart + measureIndex × tpMeasure + beatIndex × tpBeat`
- **Cascading**: Builds on measure calculation

#### Division Level
```javascript
tpDiv = tpBeat / max(1, divsPerBeat);
divStart = beatStart + divIndex × tpDiv;
divStartTime = beatStartTime + divIndex × spDiv;
```
- **Anchor**: `beatStart` (already cascaded from phrase+measure+beat)
- **Index**: `divIndex` from play.js division loop
- **Duration**: `tpDiv` calculated from beat/divisions
- **Formula**: `beatStart + divIndex × tpDiv`
- **Division count**: From composer.getDivisions()

#### Subdivision Level
```javascript
tpSubdiv = tpDiv / max(1, subdivsPerDiv);
subdivStart = divStart + subdivIndex × tpSubdiv;
subdivStartTime = divStartTime + subdivIndex × spSubdiv;
```
- **Anchor**: `divStart` (cascaded from phrase+measure+beat+div)
- **Index**: `subdivIndex` from play.js subdivision loop
- **Duration**: `tpSubdiv` calculated from division/subdivisions
- **Formula**: `divStart + subdivIndex × tpSubdiv`
- **Subdivision count**: From composer.getSubdivisions()

#### Subsubdivision Level
```javascript
tpSubsubdiv = tpSubdiv / max(1, subsubdivsPerSub);
subsubdivStart = subdivStart + subsubdivIndex × tpSubsubdiv;
subsubdivStartTime = subdivStartTime + subsubdivIndex × spSubsubdiv;
```
- **Anchor**: `subdivStart` (cascaded from all parent levels)
- **Index**: `subsubdivIndex` from play.js subsubdivision loop
- **Duration**: `tpSubsubdiv` calculated from subdivision/subsubdivisions
- **Formula**: `subdivStart + subsubdivIndex × tpSubsubdiv`
- **Subsubdivision count**: From composer.getSubsubdivs()

### Delicate Dependencies

Each calculation requires three components:

1. **Parent Position**
   - From `layer.state` (phraseStart) or previous calculation (beatStart, divStart, etc.)
   - Set by LM.activate() or previous setUnitTiming() call
   - Anchor point for this level's calculations

2. **Loop Index**
   - From play.js nested loops (measureIndex, beatIndex, divIndex, etc.)
   - Determines position within parent unit
   - Multiplied by duration to get offset

3. **Duration Multiplier**
   - Calculated in setUnitTiming() from meter/composer (tpMeasure, tpBeat, tpDiv, etc.)
   - Layer-specific for some values (tpMeasure varies by layer)
   - Derived from parent duration divided by count

### Polyrhythm Synchronization Example

**Primary Layer (4/4):**
```
phraseStart = 0
tpMeasure = 480 (4/4 in MIDI ticks)
measureIndex = 0
measureStart = 0 + 0 × 480 = 0

measureIndex = 1
measureStart = 0 + 1 × 480 = 480

measureIndex = 2
measureStart = 0 + 2 × 480 = 960
```

**Poly Layer (3/4):**
```
phraseStart = 0
tpMeasure = 360 (3/4 in MIDI ticks)
measureIndex = 0
measureStart = 0 + 0 × 360 = 0

measureIndex = 1
measureStart = 0 + 1 × 360 = 360

measureIndex = 2
measureStart = 0 + 2 × 360 = 720
```

**Synchronization:**
- Both layers start at tick 0
- Different tick rates per measure (480 vs 360)
- After appropriate measure counts, both reach same `spPhrase` (seconds)
- Phrase boundaries align in absolute time despite different tick counts
- This is **meter spoofing** in action

### Why Delicate?

1. **Cascading calculations** - Each level depends on parent being calculated first
2. **State dependencies** - Requires layer.state to be properly restored by LM.activate()
3. **Loop coordination** - play.js loop indices must align with calculation expectations
4. **Layer-specific values** - Some variables (tpMeasure) differ per layer
5. **Synchronized values** - Some variables (spPhrase) must match across layers
6. **Timing precision** - Small errors cascade through all child calculations

### Usage Pattern in play.js

```javascript
for phrase
  LM.activate(layer)              // Restores phraseStart, tpMeasure, etc.
  setUnitTiming('phrase')         // Calculates tpPhrase, spPhrase

  for measure (measureIndex)
    setUnitTiming('measure')      // Calculates measureStart from phraseStart + measureIndex×tpMeasure

    for beat (beatIndex)
      setUnitTiming('beat')       // Calculates beatStart from cascaded position
      playNotes()                 // Uses beatStart for MIDI tick positions

      for div (divIndex)
        setUnitTiming('division') // Calculates divStart from beatStart

        for subdiv (subdivIndex)
          setUnitTiming('subdivision')  // Calculates subdivStart from divStart
          playNotes()             // Uses subdivStart for precise timing
```

Each `setUnitTiming()` call calculates the next level's absolute position using the pattern:
```
currentStart = parentStart + currentIndex × currentDuration
```

This cascading pattern enables complex polyrhythmic timing while keeping each calculation simple and direct.

---

## TimingContext Class - Timing State Encapsulation

### Purpose
Encapsulates all timing state for a single layer, providing methods for state management and advancement.

### Implementation
```javascript
TimingContext = class TimingContext {
  constructor(initialState = {}) {
    this.phraseStart = initialState.phraseStart || 0;
    this.phraseStartTime = initialState.phraseStartTime || 0;
    this.sectionStart = initialState.sectionStart || 0;
    this.sectionStartTime = initialState.sectionStartTime || 0;
    this.sectionEnd = initialState.sectionEnd || 0;
    this.tpSec = initialState.tpSec || 0;
    this.tpSection = initialState.tpSection || 0;
    this.spSection = initialState.spSection || 0;
    this.numerator = initialState.numerator || 4;
    this.denominator = initialState.denominator || 4;
    this.measuresPerPhrase = initialState.measuresPerPhrase || 1;
    this.tpPhrase = initialState.tpPhrase || 0;
    this.spPhrase = initialState.spPhrase || 0;
    this.measureStart = initialState.measureStart || 0;
    this.measureStartTime = initialState.measureStartTime || 0;
    this.tpMeasure = initialState.tpMeasure || (typeof PPQ !== 'undefined' ? PPQ * 4 : 480 * 4);
    this.spMeasure = initialState.spMeasure || 0;
    this.meterRatio = initialState.meterRatio || (this.numerator / this.denominator);
    this.bufferName = initialState.bufferName || '';
  }

  saveFrom(globals) {
    // Saves all timing properties from global variables
  }

  restoreTo(globals) {
    // Restores all timing properties to global variables
  }

  advancePhrase(tpPhrase, spPhrase) {
    this.phraseStart += tpPhrase;
    this.phraseStartTime += spPhrase;
    this.tpSection += tpPhrase;
    this.spSection += spPhrase;
  }

  advanceSection() {
    this.sectionStart += this.tpSection;
    this.sectionStartTime += this.spSection;
    this.sectionEnd += this.tpSection;
    this.tpSection = 0;
    this.spSection = 0;
  }
};
```

### Methods

#### `saveFrom(globals)`
Saves all timing properties from global variables to the TimingContext instance:
```javascript
ctx.saveFrom({
  phraseStart, phraseStartTime, sectionStart, sectionStartTime,
  sectionEnd, tpSec, tpSection, spSection, numerator, denominator,
  measuresPerPhrase, tpPhrase, spPhrase, measureStart, measureStartTime,
  tpMeasure, spMeasure
});
```

#### `restoreTo(globals)`
Restores all timing properties from TimingContext to global variables:
```javascript
ctx.restoreTo(globalThis);
// Now: phraseStart, tpMeasure, etc. have values from ctx
```

#### `advancePhrase(tpPhrase, spPhrase)`
Advances phrase boundaries:
- Increments `phraseStart` by `tpPhrase` (ticks)
- Increments `phraseStartTime` by `spPhrase` (seconds)
- Accumulates into section totals

#### `advanceSection()`
Advances section boundaries and resets accumulators:
- Increments `sectionStart` by `tpSection`
- Increments `sectionStartTime` by `spSection`
- Increments `sectionEnd` by `tpSection`
- Resets `tpSection` and `spSection` to 0

### Benefits
- **Encapsulation** - All timing state in one object
- **Type safety** - Clear structure with default values
- **Methods** - Explicit operations instead of manual property copying
- **Testability** - Can test TimingContext in isolation

---

## LayerManager (LM) - Context Switching for Polyrhythmic Layers

### Purpose
Manages separate timing contexts for each layer, enabling polyrhythmic generation with different tick rates but synchronized absolute time.

### Architecture Pattern
```
1. register() → Create layer with TimingContext
2. activate(layer) → Restore layer's timing to globals
3. Process with globals → Composition uses shared variables
4. advance(layer) → Save globals, advance boundaries
```

### Core Methods

#### `LM.register(name, buffer, initialState, setupFn)`
Creates a new layer with private timing state:
```javascript
const { state: primary, buffer: c1 } = LM.register('primary', c1, {}, setupFn);
```

**Parameters:**
- `name` - Layer identifier string
- `buffer` - CSVBuffer instance (from writer.js), array, or string name
- `initialState` - Optional state overrides (passed to TimingContext constructor)
- `setupFn` - Optional initialization function

**Returns:** `{ state, buffer }` where:
- `state` - TimingContext instance
- `buffer` - The layer's CSVBuffer

**Process:**
1. Creates new `TimingContext(initialState)`
2. Resolves buffer (CSVBuffer, array, or creates new CSVBuffer from string)
3. Attaches buffer to LM.layers[name]
4. Calls setupFn if provided (with c = buffer temporarily)
5. Returns state and buffer for destructuring

#### `LM.activate(name, isPoly)`
Switches to a layer's timing context:
```javascript
LM.activate('primary', false);  // Restore primary layer's timing
```

**Process:**
1. Set `c = layer.buffer` (switch active buffer)
2. Set `LM.activeLayer = name`
3. Store current meter into layer state
4. Call `layer.state.restoreTo(globalThis)` - restores all timing variables
5. If `isPoly === true`, set poly meter and measuresPerPhrase2
6. Recalculate `spPhrase` and `tpPhrase` based on active meter

**Result:** All timing globals now from this layer's context

#### `LM.advance(name, advancementType)`
Advances timing boundaries and saves state:
```javascript
LM.advance('primary', 'phrase');  // After phrase completes
LM.advance('primary', 'section'); // After section completes
```

**Process:**
1. Reset rhythm counters (beatRhythm, divRhythm, subdivRhythm)
2. Call `layer.state.saveFrom(globals)` - save current timing
3. Call appropriate advancement method:
   - `'phrase'`: `layer.state.advancePhrase(tpPhrase, spPhrase)`
   - `'section'`: `layer.state.advanceSection()`

**Result:** Layer state updated with advanced boundaries

### Why Context Switching?

**Problem:** Different layers need different tick rates (polyrhythm) but must synchronize at phrase boundaries.

**Solution:** Each layer maintains private TimingContext, but composition code uses simple global variables.

**Example:**
```javascript
// Primary layer: 4/4 meter
LM.activate('primary');
// Now: tpMeasure = 1920, phraseStart = 0
setUnitTiming('measure');  // measureStart = 0 + measureIndex × 1920

// Poly layer: 7/8 meter
LM.activate('poly');
// Now: tpMeasure = 1680, phraseStart = 0 (different tick rate!)
setUnitTiming('measure');  // measureStart = 0 + measureIndex × 1680

// Both layers: spPhrase synchronized (same seconds)
// Result: Different tick counts, same absolute time
```

### Integration with Meter Spoofing

LayerManager enables meter spoofing across multiple layers:

1. **Primary layer** (7/11): tpMeasure = calculated from spoofed meter
2. **Poly layer** (5/8): tpMeasure = calculated from different spoofed meter
3. Both have same `spPhrase` (synchronized seconds)
4. Phrase boundaries align perfectly in time
5. Each layer's CSV file has independent tick counts

### Scalability

Unlimited layers supported:
```javascript
LM.register('tertiary', c3, {}, setupFn);
LM.register('quaternary', c4, {}, setupFn);
// ... as many layers as needed
```

Each layer maintains independent TimingContext, all synchronized through identical `spPhrase` values.
