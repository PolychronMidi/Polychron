# backstage.js - Utility Functions and Global State

> **Source**: `src/backstage.js`
> **Status**: Core Module - Foundation
> **Dependencies**: None (foundational)

## Overview

**backstage.js** provides the foundation for all other modules - mathematical utilities, randomization systems, global state, and MIDI infrastructure. It's the first file loaded, establishing the environment for everything else.

**Core Responsibilities:**
- **Mathematical utilities** - Specialized clamping and boundary functions
- **Randomization** - Weighted random selection, controlled variation, probabilistic modulation
- **Global state** - All timing, musical, and MIDI variables
- **MIDI infrastructure** - Channel definitions, binaural routing, tuning
- **CSV composition** - Event building for MIDI output

## Architecture Role

**backstage.js** is the **foundation layer**:
- **Imported first** by stage.js to initialize global environment
- **Used by all modules** - Provides utilities to play.js, time.js, composers.js, rhythm.js, stage.js
- **Establishes globals** - Timing, channel routing, state variables
- **No dependencies** - Self-contained utility library

---

## Mathematical Utilities

### Standard Clamping Functions

#### `clamp(value, min, max)`
Standard boundary enforcement - forces value into [min, max] range:
```javascript
clamp = (value, min, max) => m.min(m.max(value, min), max);
```

#### `modClamp(value, min, max)`
Wrapping boundary - values wrap around circularly:
```javascript
modClamp = (value, min, max) => {
  const range = max - min + 1;
  return ((value - min) % range + range) % range + min;
};
```
**Use case**: Octave wrapping, scale degree cycling

### Specialized Variants

#### `softClamp(value, min, max, softness)`
Gradual transition instead of hard cutoff (compression behavior):
```javascript
softClamp = (value, min, max, softness = 0.1) => {
  if (value < min) return min + (value - min) * softness;
  if (value > max) return max - (value - max) * softness;
  return value;
};
```

#### `scaleClamp(value, min, max, factor, maxFactor, base)`
Adaptive boundaries that scale based on reference point:
```javascript
scaleClamp = (value, min, max, factor, maxFactor = factor, base = value) => {
  const scaledMin = m.max(min * factor, min);
  const scaledMax = m.min(max * maxFactor, max);
  const lowerBound = m.max(min, m.floor(base * factor));
  const upperBound = m.min(max, m.ceil(base * maxFactor));
  return clamp(value, lowerBound, upperBound);
};
```
**Use case**: Tempo-scaled parameter ranges

#### `logClamp(value, min, max, base)` and `expClamp(value, min, max, base)`
Non-linear parameter mapping using logarithmic/exponential curves - natural for frequency and pitch.

---

## Randomization System

### Core Random Functions

#### `rf = randomFloat(min1, max1, min2, max2)`
Flexible float generation with multiple calling patterns:

```javascript
rf = (min1=1, max1, min2, max2) => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const totalRange = range1 + range2;
    const rand = m.random() * totalRange;
    if (rand < range1) return m.random() * (range1 + Number.EPSILON) + min1;
    else return m.random() * (range2 + Number.EPSILON) + min2;
  } else {
    return m.random() * (max1 - min1 + Number.EPSILON) + min1;
  }
};
```

**Calling patterns:**
- `rf()` → 0 to 1
- `rf(max)` → 0 to max
- `rf(min, max)` → min to max
- `rf(min1, max1, min2, max2)` → value from one of two ranges randomly

#### `ri = randomInt(min1, max1, min2, max2)`
Integer variant with proper rounding for whole number constraints.

### Advanced Random Variations

#### `rl = randomLimitedChange(currentValue, minChange, maxChange, minValue, maxValue)`
Controlled evolution - new value based on current value:
```javascript
rl = (currentValue, minChange, maxChange, minValue, maxValue, type='i') => {
  const adjustedMinChange = m.min(minChange, maxChange);
  const adjustedMaxChange = m.max(minChange, maxChange);
  const newMin = m.max(minValue, currentValue + adjustedMinChange);
  const newMax = m.min(maxValue, currentValue + adjustedMaxChange);
  return type === 'f' ? rf(newMin, newMax) : ri(newMin, newMax);
};
```
**Use case**: Gradual parameter evolution (balOffset, binauralFreqOffset)

#### `rv = randomVariation(value, boostRange, frequency, deboostRange)`
Probabilistic modulation - applies variation based on frequency:
```javascript
rv = (value, boostRange=[.05,.10], frequency=.05, deboostRange=boostRange) => {
  const range = rf() < .5 ? boostRange : deboostRange;
  const factor = rf() < frequency ? 1 + rf(...range) : 1;
  return value * factor;
};
```
**Use case**: Humanizing parameter values, creating natural fluctuations

### Weighted Random Selection

#### `rw = randomWeighted(min, max, weights)`
Selects value from range using weighted probability distribution:
```javascript
rw = (min, max, weights) => {
  const normalized = normalizeWeights(weights, min, max);
  let cumulative = 0;
  const rand = m.random();
  for (let i = 0; i < normalized.length; i++) {
    cumulative += normalized[i];
    if (rand <= cumulative) return min + i;
  }
  return max;
};
```
**Use case**: Biased random selection (e.g., NUMERATOR config favors 4/4, 3/4)

#### `ra = randomArrayValue(array)`
Picks random element from array.

---

## Global State Variables

### Timing Hierarchy
```javascript
phraseStart, phraseStartTime, measureStart, measureStartTime
beatStart, beatStartTime, divStart, divStartTime
subdivStart, subdivStartTime, subsubdivStart, subsubdivStartTime
tpPhrase, spPhrase, tpMeasure, spMeasure, tpBeat, spBeat, tpDiv, spDiv
tpSubdiv, spSubdiv, tpSubsubdiv, spSubsubdiv
```

### Musical Parameters
```javascript
numerator, denominator, meterRatio
measuresPerPhrase, measuresPerPhrase1, measuresPerPhrase2
polyNumerator, polyDenominator
divsPerBeat, subdivsPerDiv, subsubdivsPerSub
```

### Loop Counters
```javascript
sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, subsubdivIndex
```

### Note/Drum Parameters
```javascript
velocity, on, sustain, beatRhythm, divRhythm, subdivRhythm
crossModulation, lastCrossMod
```

### Audio Effects
```javascript
flipBin, beatsUntilBinauralShift, binauralFreqOffset, binauralPlus, binauralMinus
balOffset, sideBias, lBal, rBal, cBal, cBal2, cBal3, refVar, bassVar
```

### MIDI Channel Definitions
```javascript
cCH1, cCH2, lCH1, lCH2, rCH1, rCH2  // Source channels
cCH2*, lCH2*, rCH2*                 // Reflection channels
cCH3, lCH3, rCH3                    // Bass channels
drumCH                              // Drum channel (15)
```

### Binaural Configuration
```javascript
binauralL, binauralR     // Channel arrays
flipBinT, flipBinF       // Channel routing for binaural state
flipBinT2, flipBinF2     // Volume routing during transitions
BINAURAL = {min, max}    // 8-12 Hz alpha wave range
```

---

## MIDI Infrastructure

### Tuning System
```javascript
PPQ = 480                    // Pulses per quarter note
BPM = 120                    // Beats per minute
midiBPM, tpSec              // Adjusted for meter spoofing
tuningFrequency = 432       // Hz
tuningPitchBend = 0         // 432Hz pitch bend amount
```

### Bpmscaling
```javascript
bpmRatio, bpmRatio2, bpmRatio3  // Multiple tempo scaling factors
```

### Logger Configuration
```javascript
LOG = 'none'  // 'none', 'all', or comma-separated unit types
```

---

## Quick Reference

| Function | Purpose |
|----------|---------|
| `clamp(v, min, max)` | Force v into [min, max] |
| `modClamp(v, min, max)` | Wrap v around range |
| `rf()`, `ri()` | Random float/int |
| `rl()` | Controlled evolution |
| `rv()` | Probabilistic variation |
| `rw()` | Weighted random |
| `ra()` | Random array value |

---

## Design Philosophy

**"Minimal Abstraction"** - Direct access to all utilities and globals with:
- Compact function names for frequent use
- Flexible parameter patterns (rf() works 4 ways)
- Zero encapsulation overhead
- Performance-optimized algorithms
- Mathematical precision for audio/MIDI
