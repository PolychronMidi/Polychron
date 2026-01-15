# time.js - Timing Engine and Temporal Management System

> **Source**: `src/time.js`
> **Status**: Core Module - Timing & Meter Spoofing
> **Dependencies**: backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)), writer.js ([code](../src/writer.js)) ([doc](writer.md))

## Overview

**time.js** is the **temporal engine** of Polychron, handling all timing calculations, meter management, and the revolutionary "meter spoofing" technology that enables **any time signature** to work within MIDI constraints.

**Core Capabilities:**
- **Meter spoofing** - Converts non-power-of-2 time signatures (7/11, 420/69, etc.) to MIDI-compatible equivalents
- **Polyrhythm calculation** - Finds optimal measure alignments between different meters
- **Hierarchical timing** - Precise calculations across 7 nested levels: section → phrase → measure → beat → division → subdivision → subsubdivision
- **Dual-layer context management** - LayerManager (LM) enables independent polyrhythmic layers with synchronized time
- **MIDI timing events** - Generates tempo and meter change events via writer.js

## Architecture Role

**time.js** serves as the **timing coordinator**:
- **play.js** ([code](../src/play.js)) ([doc](play.md)) - Calls setUnitTiming() at each hierarchy level and drives phrase/section advancement via LM
- **composers.js** ([code](../src/composers.js)) ([doc](composers.md)) - Provides division/subdivision counts that determine timing granularity
- **writer.js** ([code](../src/writer.js)) ([doc](writer.md)) - Receives MIDI timing events (tempo, meter) via setMidiTiming()
- **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md)) - Mathematical utility support (pow, log, ceil, floor)

---

## Meter Spoofing: `getMidiMeter()`

### The Problem
MIDI supports only time signatures where the denominator is a power of 2 (2, 4, 8, 16, 32). Complex meters like 7/11 or 5/7 cannot be directly expressed in MIDI format, causing composition to fail.

### The Solution
**Meter spoofing** finds the nearest power-of-2 denominator while calculating a **sync factor** to preserve the original meter's musical feel:

```javascript
getMidiMeter = () => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error(`Invalid meter: ${numerator}/${denominator}`);
  }
  
  meterRatio = numerator / denominator;
  isPowerOf2 = (n) => { return (n & (n - 1)) === 0; }

  if (isPowerOf2(denominator)) {
    // Already MIDI-compatible
    midiMeter = [numerator, denominator];
  } else {
    // Find nearest power-of-2 denominator
    const high = 2 ** m.ceil(m.log2(denominator));
    const highRatio = numerator / high;
    const low = 2 ** m.floor(m.log2(denominator));
    const lowRatio = numerator / low;
    midiMeter = m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio)
      ? [numerator, high]
      : [numerator, low];
  }

  midiMeterRatio = midiMeter[0] / midiMeter[1];
  syncFactor = midiMeterRatio / meterRatio;
  midiBPM = BPM * syncFactor;
  tpSec = midiBPM * PPQ / 60;
  tpMeasure = PPQ * 4 * midiMeterRatio;
  spMeasure = (60 / BPM) * 4 * meterRatio;
  return midiMeter;
};
```

### Algorithm
1. **Check if already MIDI-compatible** - If denominator is a power of 2, use directly
2. **Find bracket** - Locate the nearest higher and lower powers of 2
3. **Compare ratios** - Calculate how far each option deviates from the original meter ratio
4. **Choose closer match** - Select the power-of-2 that minimizes distortion
5. **Calculate sync factor** - Ratio between MIDI meter and actual meter (enables tempo scaling)
6. **Set MIDI values** - Compute ticks-per-second, ticks-per-measure, seconds-per-measure

### Example: 7/11 Time
- **Original ratio**: 7 ÷ 11 = 0.636
- **Next higher power of 2**: 16 (7/16 = 0.4375)
- **Next lower power of 2**: 8 (7/8 = 0.875)
- **Higher deviation**: |0.636 - 0.4375| = 0.1985
- **Lower deviation**: |0.636 - 0.875| = 0.239
- **Choose**: 7/16 (closer match)
- **Sync factor**: (7/16) ÷ (7/11) ≈ 1.3125
- **Adjusted BPM**: 120 × 1.3125 = 157.5

---

## Polyrhythm Discovery: `getPolyrhythm()`

### Purpose
Finds the **optimal measure alignment** between primary and poly layers so they synchronize in time despite different meters.

```javascript
getPolyrhythm = () => {
  if (!composer) return;
  while (true) {
    [polyNumerator, polyDenominator] = composer.getMeter(true, true);
    polyMeterRatio = polyNumerator / polyDenominator;
    let bestMatch = {
      primaryMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity,
      polyNumerator: polyNumerator,
      polyDenominator: polyDenominator
    };

    // Search for measure counts that align both layers
    for (let primaryMeasures = 1; primaryMeasures < 7; primaryMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
        // Check if duration matches (within floating-point epsilon)
        if (m.abs(primaryMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
          let currentMatch = {
            primaryMeasures: primaryMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: primaryMeasures + polyMeasures,
            polyNumerator: polyNumerator,
            polyDenominator: polyDenominator
          };
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }

    // Accept match if it meets constraints
    if (bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1)) &&
        !(numerator === polyNumerator && denominator === polyDenominator)) {
      measuresPerPhrase1 = bestMatch.primaryMeasures;
      measuresPerPhrase2 = bestMatch.polyMeasures;
      return;
    }
  }
};
```

### Algorithm
1. **Get poly meter** - Request new meter from composer
2. **Calculate poly ratio** - polyNumerator ÷ polyDenominator
3. **Search measure combinations** - Try all combinations (1-6 measures each)
4. **Test duration equality** - Do N primary measures equal M poly measures in time?
5. **Find shortest** - Choose the combination with smallest total measure count
6. **Set phrase structure** - measuresPerPhrase1 (primary), measuresPerPhrase2 (poly)

### Example: 4/4 vs 3/4 Polyrhythm
- **4/4 ratio**: 1.0, **3/4 ratio**: 0.75
- **Test 1**: 1 × 1.0 = 1.0 vs 1 × 0.75 = 0.75 → No match
- **Test 2**: 2 × 1.0 = 2.0 vs 3 × 0.75 = 2.25 → No match  
- **Test 3**: 3 × 1.0 = 3.0 vs 4 × 0.75 = 3.0 → **Match!**
- **Result**: 3 primary measures = 4 poly measures in time

---

## Hierarchical Timing: `setUnitTiming()`

### Purpose
Central function called at each level of the timing hierarchy. Calculates absolute tick and time positions for every note by cascading parent positions through each nested level.

### Called From
play.js nested loops at each hierarchy level:
```javascript
for (sectionIndex = 0; ...)
  LM.activate(layer)
  setUnitTiming('phrase')
  for (phraseIndex = 0; ...)
    for (measureIndex = 0; ...)
      setUnitTiming('measure')
      for (beatIndex = 0; ...)
        setUnitTiming('beat')
        for (divIndex = 0; ...)
          setUnitTiming('division')
          for (subdivIndex = 0; ...)
            setUnitTiming('subdivision')
            for (subsubdivIndex = 0; ...)
              setUnitTiming('subsubdivision')
              playNotes()  // Uses subsubdivStart
```

### Implementation
```javascript
setUnitTiming = (unitType) => {
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec in setUnitTiming: ${tpSec}`);
  }

  switch (unitType) {
    case 'phrase':
      tpPhrase = tpMeasure * measuresPerPhrase;
      spPhrase = tpPhrase / tpSec;
      break;

    case 'measure':
      measureStart = phraseStart + measureIndex * tpMeasure;
      measureStartTime = phraseStartTime + measureIndex * spMeasure;
      setMidiTiming();
      beatRhythm = setRhythm('beat');
      break;

    case 'beat':
      trackBeatRhythm();
      tpBeat = tpMeasure / numerator;
      spBeat = tpBeat / tpSec;
      beatStart = phraseStart + measureIndex * tpMeasure + beatIndex * tpBeat;
      beatStartTime = measureStartTime + beatIndex * spBeat;
      divsPerBeat = composer ? composer.getDivisions() : 1;
      divRhythm = setRhythm('div');
      break;

    case 'division':
      trackDivRhythm();
      tpDiv = tpBeat / m.max(1, divsPerBeat);
      spDiv = tpDiv / tpSec;
      divStart = beatStart + divIndex * tpDiv;
      divStartTime = beatStartTime + divIndex * spDiv;
      subdivsPerDiv = m.max(1, composer ? composer.getSubdivisions() : 1);
      subdivRhythm = setRhythm('subdiv');
      break;

    case 'subdivision':
      trackSubdivRhythm();
      tpSubdiv = tpDiv / m.max(1, subdivsPerDiv);
      spSubdiv = tpSubdiv / tpSec;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubdivsPerSub = composer ? composer.getSubsubdivs() : 1;
      subsubdivRhythm = setRhythm('subsubdiv');
      break;

    case 'subsubdivision':
      trackSubsubdivRhythm();
      tpSubsubdiv = tpSubdiv / m.max(1, subsubdivsPerSub);
      spSubsubdiv = tpSubsubdiv / tpSec;
      subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;
      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;
      break;

    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  logUnit(unitType);
};
```

### Cascading Position Pattern
Each level computes absolute position as: **parent_start + current_index × duration**

| Level | Formula | Example |
|-------|---------|---------|
| **Phrase** | `tpMeasure × measuresPerPhrase` | 480 × 4 = 1920 ticks |
| **Measure** | `phraseStart + measureIndex × tpMeasure` | 0 + 1 × 480 = 480 |
| **Beat** | `phraseStart + measureIndex × tpMeasure + beatIndex × tpBeat` | 0 + 0 × 480 + 2 × 120 = 240 |
| **Division** | `beatStart + divIndex × tpDiv` | 240 + 3 × 30 = 330 |
| **Subdivision** | `divStart + subdivIndex × tpSubdiv` | 330 + 1 × 10 = 340 |
| **Subsubdivision** | `subdivStart + subsubdivIndex × tpSubsubdiv` | 340 + 2 × 2 = 344 |

### Why This Matters
- **Precision**: Every note has an absolute, unambiguous tick position
- **Synchronization**: Both layers have identical `spPhrase` (seconds), so phrase boundaries align
- **Efficiency**: Calculations are simple arithmetic; no complex state tracking
- **Cascading**: Small errors don't accumulate because each level recalculates from absolute parent position

### Polyrhythm Example
**4/4 Primary Layer:**
- `tpMeasure = 480`, `measuresPerPhrase = 3`
- Phrase duration: 480 × 3 = 1440 ticks

**3/4 Poly Layer:**
- `tpMeasure = 360`, `measuresPerPhrase = 4`
- Phrase duration: 360 × 4 = 1440 ticks (same!)

Both layers reach end of phrase at identical absolute time despite different tick counts per measure.

---

## Timing State: `TimingContext` Class

### Purpose
Encapsulates all timing variables for a layer so they can be saved/restored without manual property copying.

### Storage
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

  saveFrom(globals) { /* Copies properties from globals object to this */ }
  restoreTo(globals) { /* Copies properties from this to globals object */ }
  
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

### Key Methods
- **`saveFrom(globals)`** - Copies timing variables FROM globals TO this object
- **`restoreTo(globals)`** - Copies timing variables FROM this object TO globals
- **`advancePhrase(tpPhrase, spPhrase)`** - Move phrase start forward by tpPhrase ticks and spPhrase seconds
- **`advanceSection()`** - Move section boundaries forward using accumulated tpSection/spSection

---

## Layer Context Management: `LayerManager` (LM)

### Purpose
Manages multiple timing contexts so different layers can have different meters but stay synchronized in absolute time.

### Architecture Pattern
```
1. register(layer_name, buffer)  → Create TimingContext for layer
2. activate(layer_name)          → Restore layer's timing to globals
3. [...composition code...]       → Uses globals (which are layer-specific)
4. advance(layer_name)           → Save globals back to layer's TimingContext
```

### Core Methods

#### `LM.register(name, buffer, initialState, setupFn)`
Creates a new layer:
```javascript
const { state: primary, buffer: c1 } = LM.register('primary', c1, {}, setupFn);
```

- **Parameters**:
  - `name` - Layer identifier (string)
  - `buffer` - CSVBuffer instance, array, or string (creates CSVBuffer if string)
  - `initialState` - Optional state overrides
  - `setupFn` - Optional initialization function to run with this layer's buffer

- **Returns**: `{ state: TimingContext, buffer: CSVBuffer|Array }`

- **Process**:
  1. Create new TimingContext
  2. Resolve buffer (if string, create CSVBuffer; if CSVBuffer, use directly; if array, use as-is)
  3. Store layer in `LM.layers[name] = { buffer, state }`
  4. Call setupFn if provided (with c temporarily set to this layer's buffer)
  5. Return both state and buffer for convenient destructuring

#### `LM.activate(name, isPoly)`
Switch to a layer's timing context:
```javascript
LM.activate('primary', false);
// Now all timing globals are from primary layer
setUnitTiming('measure');  // Uses primary layer's tpMeasure
```

- **Parameters**:
  - `name` - Layer to activate
  - `isPoly` - If true, use poly meter and measuresPerPhrase2; if false, use primary meter and measuresPerPhrase1

- **Process**:
  1. Set `c = layer.buffer` (switch active buffer)
  2. Set `LM.activeLayer = name`
  3. Store current meter into layer state
  4. Call `layer.state.restoreTo(globalThis)` - restore all timing variables from this layer
  5. Recalculate `spPhrase` and `tpPhrase` based on active meter
  6. Return snapshot of key timing values

- **Result**: All global timing variables now reflect this layer's state

#### `LM.advance(name, advancementType)`
Advance a layer's timing and save state:
```javascript
LM.advance('primary', 'phrase');  // Advance to next phrase
```

- **Parameters**:
  - `name` - Layer to advance
  - `advancementType` - 'phrase' or 'section'

- **Process**:
  1. Set `c = layer.buffer` (switch to this layer's buffer)
  2. Reset rhythm counters (beatRhythm, divRhythm, etc.)
  3. Call `layer.state.saveFrom(globals)` - save current timing to layer state
  4. Call appropriate advancement method:
     - 'phrase': `layer.state.advancePhrase(tpPhrase, spPhrase)`
     - 'section': `layer.state.advanceSection()`
  5. Call `layer.state.restoreTo(globalThis)` - restore advanced state back to globals

- **Result**: Layer state updated with new phrase/section boundaries

### Usage Pattern in play.js

```javascript
// Dual-layer composition
for (sectionIndex = 0; sectionIndex < sections; sectionIndex++) {
  for (phraseIndex = 0; phraseIndex < measuresPerPhrase1; phraseIndex++) {
    
    // PRIMARY LAYER
    LM.activate('primary', false);
    setUnitTiming('phrase');
    for (measureIndex = 0; ...)
      setUnitTiming('measure');
      for (beatIndex = 0; ...)
        setUnitTiming('beat');
        playNotes();  // Primary notes on primary layer buffer
    LM.advance('primary', 'phrase');
    
    // POLY LAYER
    LM.activate('poly', true);
    setUnitTiming('phrase');
    for (measureIndex = 0; ...)
      setUnitTiming('measure');
      for (beatIndex = 0; ...)
        setUnitTiming('beat');
        playNotes();  // Poly notes on poly layer buffer
    LM.advance('poly', 'phrase');
  }
  LM.advance('primary', 'section');
  LM.advance('poly', 'section');
}
```

### Why This Works
- **Isolation**: Each layer maintains its own timing state
- **Switch speed**: `activate()` restores a layer's state in O(1)
- **Synchronization**: Both layers have identical `spPhrase` (absolute time), ensuring alignment
- **Scalability**: Add 3rd, 4th layers with `LM.register('tertiary', ...)` - no changes needed

---

## Supporting Functions

### `setMidiTiming(tick)`
Writes MIDI timing events (tempo and meter changes) to the active buffer:
```javascript
setMidiTiming = (tick=measureStart) => {
  p(c,
    { tick: tick, type: 'bpm', vals: [midiBPM] },
    { tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );
};
```
- Writes at the start of each measure
- Uses `midiBPM` (adjusted for meter spoofing)
- Uses `midiMeter` (spoofed to power-of-2 denominator)

### `formatTime(seconds)`
Converts seconds to human-readable MM:SS.ssss format:
```javascript
formatTime = (seconds) => {
  const minutes = m.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};
```

### `logUnit(type)` 
Generates CSV marker events for debugging/visualization if LOG setting allows:
- Controlled by LOG environment variable ('none', 'all', or comma-separated unit types)
- Creates MIDI text events with timing info
- Useful for analyzing composition in MIDI viewer

---

## Quick Reference

| Variable | Type | Purpose |
|----------|------|---------|
| `tpSec` | number | MIDI ticks per second (tempo-dependent) |
| `tpMeasure` | number | MIDI ticks per measure (meter-dependent) |
| `tpPhrase` | number | MIDI ticks per phrase |
| `spMeasure` | number | Seconds per measure (actual time) |
| `spPhrase` | number | Seconds per phrase (synchronized across layers) |
| `meterRatio` | number | Original numerator ÷ denominator |
| `syncFactor` | number | Ratio for tempo adjustment (MIDI meter ÷ actual meter) |
| `phraseStart` | number | Absolute MIDI tick where current phrase began |
| `phraseStartTime` | number | Absolute seconds where current phrase began |

---

## Error Handling

**getMidiMeter()** validates inputs:
- Meter numerator and denominator must be finite numbers
- Denominator cannot be zero
- BPM must be positive

**setUnitTiming()** validates computation state:
- `tpSec` must be positive and finite
- Raises error if timing calculation fails

These checks prevent silent failures and help debug timing issues early.
