# backstage.js - Core Utility Functions and Global State Management

## Project Overview

**backstage.js** serves as the **foundational utility layer** for the entire Polychron system, providing essential mathematical functions, randomization utilities, global state variables, and core MIDI infrastructure. This file contains the "behind the scenes" functionality that supports all other modules.

## File Purpose

This module provides **essential infrastructure** including:
- **Advanced mathematical utilities** - Specialized clamping, scaling, and boundary functions
- **Sophisticated randomization** - Multiple random number generation patterns with weights and variations
- **Global state management** - All timing, musical, and MIDI state variables
- **MIDI channel definitions** - Complete 16-channel MIDI setup with binaural routing
- **Audio processing foundations** - Pitch bend calculations, tuning systems, channel mappings
- **CSV composition infrastructure** - Direct CSV string building and file output

## Architecture Role

**backstage.js** operates as the **foundation layer** supporting all other modules:
- **Imported first** by stage.js, establishing the global environment
- **Provides utilities** used by all other files (play.js, time.js, rhythm.js, composers.js)
- **Manages global state** that coordinates between modules
- **Defines MIDI infrastructure** used throughout the system

## Code Style Philosophy

Exemplifies the project's **"clean minimal"** philosophy:
- **Ultra-compact function definitions** - Maximum functionality in minimum code
- **Direct global variable declarations** - No unnecessary encapsulation
- **Mathematical precision** - Exact calculations for audio/MIDI applications
- **Zero abstraction overhead** - Direct access to all functionality
- **Performance-optimized** - Efficient algorithms for real-time use

## Advanced Mathematical Utility Functions

### Basic Clamping Functions

#### `clamp(value, min, max)` - Standard Boundary Enforcement
```javascript
clamp = (value, min, max) => m.min(m.max(value, min), max);
```
- **Standard clamping** - Constrains value to [min, max] range
- **Hard boundaries** - Values outside range are forced to boundary
- **Most common utility** - Used throughout system for parameter validation

#### `modClamp(value, min, max)` - Wrapping Boundary System
```javascript
modClamp = (value, min, max) => {
  const range = max - min + 1;
  return ((value - min) % range + range) % range + min;
};
```
- **Modulo-based wrapping** - Values wrap around within range
- **Circular behavior** - Going past max wraps to min, and vice versa
- **Musical applications** - Perfect for octave wrapping, scale degree cycling
- **Double modulo** - Handles negative numbers correctly

### Specialized Clamping Variants

#### `lowModClamp(value, min, max)` and `highModClamp(value, min, max)` - Asymmetric Clamping
```javascript
lowModClamp = (value, min, max) => {
  if (value >= max) { return max; }
  else if (value < min) { return modClamp(value, min, max); }
  else { return value; }
};
```
- **Asymmetric behavior** - Different handling for upper vs lower bounds
- **Hard ceiling/floor** with **wrapping floor/ceiling** respectively
- **Musical timing applications** - Allows controlled parameter evolution

#### `scaleClamp(value, min, max, factor, maxFactor, base)` - Dynamic Range Scaling
```javascript
scaleClamp = (value, min, max, factor, maxFactor = factor, base = value) => {
  const scaledMin = m.max(min * factor, min);
  const scaledMax = m.min(max * maxFactor, max);
  const lowerBound = m.max(min, m.floor(base * factor));
  const upperBound = m.min(max, m.ceil(base * maxFactor));
  return clamp(value, lowerBound, upperBound);
};
```
- **Adaptive boundaries** - Range changes based on scaling factors
- **Base value consideration** - Scaling relative to reference point
- **Dual factor support** - Different scaling for min and max
- **Musical tempo scaling** - Adjusts parameter ranges based on BPM

#### `softClamp(value, min, max, softness)` - Gradual Boundary Transitions
```javascript
softClamp = (value, min, max, softness = 0.1) => {
  if (value < min) return min + (value - min) * softness;
  if (value > max) return max - (value - max) * softness;
  return value;
};
```
- **Soft boundaries** - Gradual transition instead of hard cutoff
- **Compression behavior** - Out-of-range values compressed toward boundary
- **Audio applications** - Prevents harsh parameter jumps

#### `logClamp(value, min, max, base)` and `expClamp(value, min, max, base)`
```javascript
logClamp = (value, min, max, base = 10) => {
  const logMin = m.log(min) / m.log(base);
  const logMax = m.log(max) / m.log(base);
  const logValue = m.log(m.max(value, min)) / m.log(base);
  return m.pow(base, m.min(m.max(logValue, logMin), logMax));
};
```
- **Non-linear parameter mapping** - Logarithmic and exponential scaling
- **Frequency applications** - Natural for pitch and frequency ranges

## Sophisticated Randomization System

### Core Random Functions

#### `rf = randomFloat(min1, max1, min2, max2)` - Flexible Float Generation
```javascript
rf = randomFloat = (min1=1, max1, min2, max2) => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1; const range2 = max2 - min2;
    const totalRange = range1 + range2; const rand = m.random() * totalRange;
    if (rand < range1) { return m.random() * (range1 + Number.EPSILON) + min1; }
    else { return m.random() * (range2 + Number.EPSILON) + min2; }
  } else { return m.random() * (max1 - min1 + Number.EPSILON) + min1; }
};
```

**Multiple calling patterns**:
- `rf()` returns 0-1
- `rf(max)` returns 0-max  
- `rf(min, max)` returns min-max
- `rf(min1, max1, min2, max2)` returns value from one of two ranges randomly
- **Dual range support** - Can select from two separate ranges
- **Epsilon handling** - Prevents floating-point precision issues

#### `ri = randomInt(min1, max1, min2, max2)` - Integer Random Generation
- **Same flexibility** as rf but for whole numbers
- **Proper rounding and boundary handling** for integer constraints
- **Boundary protection** - Uses ceil/floor to ensure valid integer ranges

### Advanced Random Variations

#### `rl = randomLimitedChange(currentValue, minChange, maxChange, minValue, maxValue, type)` - Controlled Evolution
```javascript
rl = randomLimitedChange = (currentValue, minChange, maxChange, minValue, maxValue, type='i') => {
  const adjustedMinChange = m.min(minChange, maxChange);
  const adjustedMaxChange = m.max(minChange, maxChange);
  const newMin = m.max(minValue, currentValue + adjustedMinChange);
  const newMax = m.min(maxValue, currentValue + adjustedMaxChange);
  return type === 'f' ? rf(newMin, newMax) : ri(newMin, newMax);
};
```
- **Evolutionary randomization** - New value based on current value
- **Change limits** - Constrains how much value can change per iteration
- **Boundary respect** - Never exceeds absolute min/max values
- **Musical continuity** - Prevents jarring parameter jumps

#### `rv = randomVariation(value, boostRange, frequency, deboostRange)` - Probabilistic Modulation
```javascript
rv = randomVariation = (value, boostRange=[.05,.10], frequency=.05, deboostRange=boostRange) => {
  let factor;
  const singleRange = Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange = singleRange.length === 2 && typeof singleRange[0] === 'number';
  if (isSingleRange) { 
    const variation = rf(...singleRange);
    factor = rf() < frequency ? 1 + variation : 1;
  } else { 
    const range = rf() < .5 ? boostRange : deboostRange;
    factor = rf() < frequency ? 1 + rf(...range) : 1; 
  }
  return value * factor;
};
```
- **Probabilistic modification** - Only applies variation based on frequency
- **Boost/deboost ranges** - Separate ranges for positive/negative variations
- **Multiplicative variation** - Scales original value rather than adding
- **Musical expressiveness** - Creates natural parameter fluctuations

### Weighted Random Selection System

#### `normalizeWeights(weights, min, max, variationLow, variationHigh)` - Weight Processing
```javascript
normalizeWeights = (weights, min, max, variationLow=.7, variationHigh=1.3) => {
  const range = max - min + 1;
  let w = weights.map(weight => weight * rf(variationLow, variationHigh));
  // Complex interpolation and normalization logic...
  const totalWeight = w.reduce((acc, w) => acc + w, 0);
  return w.map(w => w / totalWeight);
};
```
- **Weight array processing** - Converts raw weights to probabilities
- **Range fitting** - Adjusts weight array to match desired output range
- **Interpolation/grouping** - Expands or contracts weight arrays to fit ranges
- **Randomized weights** - Adds variation to prevent mechanical selection

#### `rw = randomWeightedInRange(min, max, weights)` - Weighted Selection
```javascript
rw = randomWeightedInRange = (min, max, weights) => {
  const normalizedWeights = normalizeWeights(weights, min, max);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
};
```
- **Weighted selection** - Higher weights = higher probability
- **Range mapping** - Maps weight array indices to desired value range
- **Cumulative probability** - Standard weighted selection algorithm

#### `ra = randomInRangeOrArray(v)` - Polymorphic Selection
```javascript
ra = randomInRangeOrArray = (v) => {
  if (typeof v === 'function') {
    const result = v();
    if (Array.isArray(result) && result.length === 2 && typeof result[0] === 'number') {
      return ri(result[0], result[1]); // Treat as range
    }
    return Array.isArray(result) ? ra(result) : result;
  } else if (Array.isArray(v)) {
    return v[ri(v.length - 1)]; // Random element
  }
  return v; // Return as-is
};
```
- **Polymorphic input** - Handles functions, arrays, ranges, and values
- **Function evaluation** - Calls functions and processes results recursively
- **Range detection** - Recognizes [min, max] arrays as ranges
- **Fallback behavior** - Returns input unchanged for simple values

## Global State Management

### Comprehensive State Initialization
```javascript
measureCount=spMeasure=subsubdivStart=subdivStart=beatStart=divStart=sectionStart=
sectionStartTime=tpSubsubdiv=tpSection=spSection=finalTick=bestMatch=polyMeterRatio=
polyNumerator=tpSec=finalTime=endTime=phraseStart=tpPhrase=phraseStartTime=spPhrase=
measuresPerPhrase1=measuresPerPhrase2=subdivsPerMinute=subsubdivsPerMinute=numerator=
meterRatio=divsPerBeat=subdivsPerDiv=subdivsPerSub=measureStart=measureStartTime=
beatsUntilBinauralShift=beatCount=beatsOn=beatsOff=divsOn=divsOff=subdivsOn=subdivsOff=
noteCount=beatRhythm=divRhythm=subdivRhythm=balOffset=sideBias=firstLoop=lastCrossMod=
bpmRatio=0;
crossModulation=2.2;
velocity=99; flipBin=false;
lastUsedCHs=new Set();lastUsedCHs2=new Set();lastUsedCHs3=new Set();
```

**Global state categories**:
- **Timing variables** - All hierarchical timing state (sections through subsubdivisions)
- **Musical state** - Meter ratios, rhythm patterns, beat counters
- **Audio processing** - Cross-modulation, velocity, binaural state
- **Channel tracking** - Sets to prevent overlapping stutter effects

## MIDI Infrastructure and Audio Processing

### Tuning and Pitch Bend Mathematics
```javascript
neutralPitchBend=8192; semitone=neutralPitchBend / 2;
centsToTuningFreq=1200 * m.log2(TUNING_FREQ / 440);
tuningPitchBend=m.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

binauralFreqOffset=rf(BINAURAL.min,BINAURAL.max);
binauralOffset=(plusOrMinus)=>m.round(tuningPitchBend + semitone * (12 * m.log2((TUNING_FREQ + plusOrMinus * binauralFreqOffset) / TUNING_FREQ)));
[binauralPlus,binauralMinus]=[1,-1].map(binauralOffset);
```

**Advanced audio mathematics**:
- **MIDI pitch bend calculations** - Converts frequency ratios to MIDI pitch bend values
- **432Hz tuning support** - Calculates cent deviation from 440Hz standard
- **Binaural beat generation** - Creates frequency offsets for psychoacoustic effects
- **Logarithmic frequency relationships** - Precise mathematical conversions

### Complete MIDI Channel Architecture
```javascript
cCH1=0;cCH2=1;lCH1=2;rCH1=3;lCH3=4;rCH3=5;lCH2=6;rCH2=7;lCH4=8;drumCH=9;rCH4=10;cCH3=11;lCH5=12;rCH5=13;lCH6=14;rCH6=15;

bass=[cCH3,lCH5,rCH5,lCH6,rCH6];
bassBinaural=[lCH5,rCH5,lCH6,rCH6];
source=[cCH1,lCH1,lCH2,rCH1,rCH2];
source2=[cCH1,lCH1,lCH2,rCH1,rCH2,drumCH];
reflection=[cCH2,lCH3,lCH4,rCH3,rCH4];
reflectionBinaural=[lCH3,lCH4,rCH3,rCH4];

binauralL=[lCH1,lCH2,lCH3,lCH4,lCH5,lCH6];
binauralR=[rCH1,rCH2,rCH3,rCH4,rCH5,rCH6];
flipBinF=[cCH1,cCH2,cCH3,lCH1,rCH1,lCH3,rCH3,lCH5,rCH5];
flipBinT=[cCH1,cCH2,cCH3,lCH2,rCH2,lCH4,rCH4,lCH6,rCH6];

reflect={[cCH1]:cCH2,[lCH1]:lCH3,[rCH1]:rCH3,[lCH2]:lCH4,[rCH2]:rCH4};
reflect2={[cCH1]:cCH3,[lCH1]:lCH5,[rCH1]:rCH5,[lCH2]:lCH6,[rCH2]:rCH6};
```

**Sophisticated channel organization**:
- **16-channel MIDI mapping** - Uses all available MIDI channels efficiently
- **Naming convention**: c=center, l/r=left/right, numbers=priority/layering
- **Functional groupings** - Bass, source, reflection channels for different musical roles
- **Binaural routing** - Complete left/right channel sets for psychoacoustic processing
- **Flip-bin arrays** - Alternating channel groups for binaural beat effects
- **Reflection mapping** - Object-based channel routing for echo/reverb effects

### Effects and Control Infrastructure
```javascript
FX=[1,5,11,65,67,68,69,70,71,72,73,74,91,92,93,94,95];
allCHs=[cCH1,cCH2,cCH3,lCH1,rCH1,lCH2,rCH2,lCH3,rCH3,lCH4,rCH4,lCH5,rCH5,lCH6,rCH6,drumCH];
stutterFadeCHs=[cCH2,cCH3,lCH1,rCH1,lCH2,rCH2,lCH3,rCH3,lCH4,rCH4,lCH5,rCH5,lCH6,rCH6];
```

- **MIDI CC effects array** - Controllers for modulation, expression, reverb, chorus, etc.
- **Channel collections** - Pre-defined arrays for different processing needs
- **Stutter effect channels** - Specific channels available for stutter processing

### MIDI Utility Functions

#### `allNotesOff(tick)` and `muteAll(tick)` - MIDI Cleanup
```javascript
allNotesOff = (tick=measureStart) => {return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,123,0] })));};
muteAll = (tick=measureStart) => {return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,120,0] })));};
```
- **MIDI CC 123** - "All Notes Off" prevents stuck notes during transitions
- **MIDI CC 120** - "All Sound Off" immediately silences all sound
- **Applied to all channels** - Comprehensive cleanup across entire MIDI setup
- **Timing safety** - Uses tick-1 to ensure cleanup happens before new events

## CSV Composition Infrastructure

### Global CSV System
```javascript
p = pushMultiple = (array, ...items) => { array.push(...items); }; 
c = csvRows = [];
composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
fs = require('fs');
```
- **Push utility** - Efficient array concatenation for CSV events
- **CSV event array** - Global array collecting all MIDI events
- **Composition string** - Direct CSV string building with MIDI headers
- **File system access** - Node.js fs module for final file output

### `grandFinale()` - Final Composition Processing
```javascript
grandFinale = () => { 
  allNotesOff(sectionStart+PPQ);muteAll(sectionStart+PPQ*2);
  c = c.filter(i=>i!==null).map(i=>({...i,tick: isNaN(i.tick) || i.tick<0 ? m.abs(i.tick||0)*rf(.1,.3) : i.tick})).sort((a,b)=>a.tick-b.tick); 
  let finalTick=-Infinity; 
  c.forEach(_=>{ 
    if (!isNaN(_.tick)) {
      let type=_.type==='on' ? 'note_on_c' : (_.type || 'note_off_c'); 
      composition+=`1,${_.tick || 0},${type},${_.vals.join(',')}\n`; 
      finalTick=m.max(finalTick,_.tick); 
    } else { console.error("NaN tick value encountered:",_); } 
  }); 
  (function finale(){composition+=`1,${finalTick + tpSec * SILENT_OUTRO_SECONDS},end_track`})(); 
  fs.writeFileSync('output.csv',composition); 
  console.log('output.csv created. Track Length:',finalTime);
};
```

**Complete composition finalization**:
- **Final cleanup** - All notes off and mute commands at composition end
- **Data validation** - Filters null events, fixes invalid tick values with random recovery
- **Event sorting** - Chronological order by tick time for proper MIDI playback
- **CSV string building** - Converts event objects to standard MIDI CSV format
- **File output** - Writes complete composition to output.csv
- **Duration reporting** - Logs final composition length for user feedback

## Advanced Helper Functions

### `rlFX()` - Evolutionary Effects Control
```javascript
rlFX = (ch, effectNum, minValue, maxValue, condition=null, conditionMin=null, conditionMax=null) => {
  chFX = new Map();
  if (!chFX.has(ch)) { chFX.set(ch, {}); }
  const chFXMap = chFX.get(ch);
  if (!(effectNum in chFXMap)) {
    chFXMap[effectNum] = clamp(0, minValue, maxValue);
  }
  
  const midiEffect = {
    getValue: () => {
      let effectValue = chFXMap[effectNum];
      let newMin = minValue, newMax = maxValue;
      let change = (newMax - newMin) * rf(.1, .3);
      if (condition !== null && typeof condition === 'function' && condition(ch)) {
        newMin = conditionMin; newMax = conditionMax;
        effectValue = clamp(rl(effectValue, m.floor(-change), m.ceil(change), newMin, newMax), newMin, newMax);
      } else {
        effectValue = clamp(rl(effectValue, m.floor(-change), m.ceil(change), newMin, newMax), newMin, newMax);
      }
      chFXMap[effectNum] = effectValue;
      return effectValue;
    }
  };
  return {..._, vals: [ch, effectNum, midiEffect.getValue()]};
};
```
- **Per-channel effect memory** - Each channel maintains independent effect values
- **Evolutionary parameter changes** - Effects values evolve gradually rather than jumping
- **Conditional processing** - Special handling for specific channels via condition function
- **Change limiting** - Prevents extreme parameter jumps via controlled change amounts
- **Persistent state** - Effect values maintained across multiple calls

## Performance Characteristics

- **Zero-allocation utilities** - Functions reuse objects where possible to minimize garbage collection
- **Global state optimization** - Avoids parameter passing overhead through global variable access
- **Mathematical precision** - High-accuracy floating-point calculations for audio applications
- **Efficient randomization** - Fast random number generation with complex probability distributions
- **MIDI-optimized output** - All functions generate data directly compatible with MIDI specifications
- **Memory efficient** - Minimal object creation during composition generation, compact data structures

## Integration Points

**backstage.js** provides the foundation that all other modules depend on:
- **Mathematical utilities** - Used by time.js for timing calculations, rhythm.js for pattern processing
- **Randomization functions** - Used by composers.js for musical decisions, stage.js for audio processing
- **Global state** - Coordinates timing and musical state across all modules
- **MIDI infrastructure** - Provides channel definitions and audio processing foundations
- **CSV system** - Enables all modules to generate MIDI events through common interface

This foundational design allows the entire Polychron system to operate with maximum efficiency while maintaining the clean, minimal code philosophy throughout.

## CSVBuffer Class - MIDI Event Encapsulation

### Purpose
Encapsulates MIDI event collection with layer context metadata while preserving the minimalist `p(c)` syntax.

### Implementation
```javascript
CSVBuffer = class CSVBuffer {
  constructor(name) {
    this.name = name;    // Layer identifier
    this.rows = [];      // MIDI event array
  }
  push(...items) {
    this.rows.push(...items);
  }
  get length() {
    return this.rows.length;
  }
  clear() {
    this.rows = [];
  }
};
```

### Usage Pattern
```javascript
c1 = new CSVBuffer('primary');
c2 = new CSVBuffer('poly');
c = c1;  // Active buffer reference

p(c, {tick: 0, type: 'on', vals: [0, 60, 99]});  // Exact same syntax as before
```

### Architecture Benefits
- **Layer identification** - Each buffer knows its layer name
- **Backward compatible** - `p(c)` calls work identically
- **Metadata attached** - Layer context travels with buffer
- **Array interop** - `.rows` provides array access when needed

## LayerManager (LM) - Context Switching for Polyrhythmic Layers

### Purpose
Manages separate timing contexts for each layer, enabling polyrhythmic generation with different tick rates but synchronized absolute time.

### Architecture Pattern
```
1. register() → Create layer with initial state
2. activate(layer) → Restore layer's globals
3. Process with globals → Composition functions use shared variables
4. advance(layer) → Save updated globals to layer state
```

### Core Methods

#### `LM.register(name, buffer, initialState, setupFn)`
Creates a new layer with private timing state:
```javascript
const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, setTuningAndInstruments);
```

**Parameters:**
- `name` - Layer identifier string
- `buffer` - CSVBuffer instance, array, or string name
- `initialState` - Optional state overrides
- `setupFn` - Optional initialization function

**Returns:** `{ state, buffer }` for destructuring

**State Properties:**
- `phraseStart`, `phraseStartTime` - Phrase boundary positions (ticks, seconds)
- `sectionStart`, `sectionStartTime`, `sectionEnd` - Section boundaries
- `measureStart`, `measureStartTime` - Current measure positions
- `tpMeasure`, `spMeasure` - Ticks/seconds per measure (layer-specific)
- `tpPhrase`, `spPhrase` - Ticks/seconds per phrase
- `tpSec` - Ticks per second (tempo-adjusted)
- `tpSection`, `spSection` - Accumulated ticks/seconds per section
- `numerator`, `denominator` - Current meter
- `measuresPerPhrase` - Measures in current phrase

#### `LM.activate(name, isPoly)`
Switches to a layer's timing context:
```javascript
LM.activate('primary', false);  // Restore primary layer's timing globals
```

**Process:**
1. Switch `c` to layer's buffer
2. Store current meter into layer state
3. Restore layer-specific timing to globals:
   - `phraseStart`, `measureStart`, etc. (position anchors)
   - `tpMeasure`, `tpSec`, etc. (duration multipliers)
4. Set layer-specific meter if `isPoly === true`

**Critical:** All timing globals are now from this layer's context. Composition functions use these globals directly.

#### `LM.advance(name, advancementType)`
Advances timing boundaries and saves state:
```javascript
LM.advance('primary', 'phrase');  // After phrase completes
LM.advance('primary', 'section'); // After section completes
```

**Phrase Advancement:**
- `phraseStart += tpPhrase` - Move phrase boundary forward (layer-specific ticks)
- `phraseStartTime += spPhrase` - Move time boundary (synchronized seconds)
- `tpSection += tpPhrase` - Accumulate into section total
- `spSection += spPhrase` - Accumulate time into section total

**Section Advancement:**
- `sectionStart += tpSection` - Move section boundary by accumulated ticks
- `sectionStartTime += spSection` - Move section time
- `sectionEnd += tpSection` - Update section end
- Reset `tpSection`, `spSection` to 0

**State Preservation:** Current timing globals saved back to layer state for next activation.

### Why Context Switching?

**Problem:** Different layers need different tick rates (polyrhythm) but must synchronize at phrase boundaries.

**Solution:** Each layer maintains private state, but composition code uses simple global variables.

**Example:**
```javascript
// Primary layer: 4/4 meter, 480 tpMeasure
LM.activate('primary');
// Now: tpMeasure = 480, phraseStart = 0
setUnitTiming('measure');  // measureStart = 0 + measureIndex × 480

// Poly layer: 3/4 meter, 360 tpMeasure
LM.activate('poly');
// Now: tpMeasure = 360, phraseStart = 0 (different tick rate!)
setUnitTiming('measure');  // measureStart = 0 + measureIndex × 360

// Both layers: spPhrase is synchronized (same seconds)
// Result: Different tick counts, same absolute time at phrase boundaries
```

### Timing State Flow

**Registration Phase:**
```
LM.register('primary', c1, {})
  → Creates layer.state with default timing values
  → Attaches CSVBuffer to layer
  → Returns { state, buffer } for access
```

**Activation Phase:**
```
LM.activate('primary')
  → c = layer.buffer (switch active buffer)
  → Restore layer.state.phraseStart → phraseStart
  → Restore layer.state.tpMeasure → tpMeasure
  → All timing globals now from this layer
```

**Processing Phase:**
```
setUnitTiming('measure')
  → Uses phraseStart (from layer.state via activation)
  → Calculates measureStart = phraseStart + measureIndex × tpMeasure
  → Composition functions use measureStart for MIDI tick positions
```

**Advancement Phase:**
```
LM.advance('primary', 'phrase')
  → phraseStart += tpPhrase (advance boundary)
  → Save phraseStart → layer.state.phraseStart
  → Save tpMeasure → layer.state.tpMeasure
  → State preserved for next activation
```

### Meter Spoofing Integration

LayerManager enables meter spoofing to work across multiple layers:

1. **Primary layer** processes in its meter (e.g., 7/11)
2. **Poly layer** processes in different meter (e.g., 5/8)
3. Both have different `tpMeasure` values (different tick rates)
4. Both have same `spPhrase` values (synchronized seconds)
5. Phrase boundaries align perfectly in time
6. Result: Complex polyrhythmic relationships with perfect synchronization

### Scalability

The context switching pattern is infinitely scalable:
```javascript
LM.register('tertiary', c3, {}, setupFn);
LM.register('quaternary', c4, {}, setupFn);
// ... register as many layers as needed
```

Each layer maintains independent timing state, all synchronized at phrase boundaries through identical `spPhrase` values.