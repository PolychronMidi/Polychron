<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# backstage.ts - Core Utilities and MIDI Infrastructure

> **Status**: Core Infrastructure  
> **Dependencies**: utils.ts


## Overview

`backstage.ts` provides the **foundational infrastructure** for the entire Polychron system. It exports re-usable utilities, defines global timing state, manages MIDI channel constants, and provides channel grouping logic for binaural beats and effects routing.

**Core Responsibilities:**
- **Utility re-exports** - Makes utils.ts ([code](../src/utils.ts)) ([doc](utils.md)) functions available throughout the system
- **Global timing state** - Centralizes all timing counters and rhythmic variables
- **MIDI channel constants** - Defines all 16 channel assignments
- **Channel grouping** - Groups channels by role (source, reflection, bass, binaural sets)
- **State management** - Tracks beat counts, measures, sections, and cross-modulation

## Architecture Role

`backstage.ts` serves as the **system backbone**:
- **All modules** - Import timing variables and utility functions from here
- **stage.ts ([code](../src/stage.ts)) ([doc](stage.md))** - Uses channel constants and groupings for audio processing
- **play.ts ([code](../src/play.ts)) ([doc](play.md))** - Updates timing state during composition traversal
- **time.ts ([code](../src/time.ts)) ([doc](time.md))** - Coordinates with backstage timing variables
- **utils.ts ([code](../src/utils.ts)) ([doc](utils.md))** - Provides the actual utility implementations (re-exported here)

---

## MIDI Channel Infrastructure

### Channel Assignments

```
0  (cCH1)  - Center source channel
1  (cCH2)  - Center reflection channel
2  (lCH1)  - Left source channel 1
3  (rCH1)  - Right source channel 1
4  (lCH3)  - Left bass/reflection
5  (rCH3)  - Right bass/reflection
6  (lCH2)  - Left source channel 2
7  (rCH2)  - Right source channel 2
8  (lCH4)  - Left reflection channel 2
9  (drumCH) - Drum/percussion channel
10 (rCH4)  - Right reflection channel 2
11 (cCH3)  - Center bass channel
12 (lCH5)  - Left bass channel 1
13 (rCH5)  - Right bass channel 1
14 (lCH6)  - Left bass channel 2
15 (rCH6)  - Right bass channel 2
```

### Channel Groups

**source** - Primary melodic channels: `[cCH1, lCH1, lCH2, rCH1, rCH2]`

**reflection** - Echo/effect channels: `[cCH2, lCH3, lCH4, rCH3, rCH4]`

**bass** - Low-frequency channels: `[cCH3, lCH5, rCH5, lCH6, rCH6]`

**binauralL / binauralR** - Left/right binaural sets for psychoacoustic processing

---

## Global Timing State

Timing variables track the current position in the composition hierarchy:

### Counters
- `sectionIndex` - Current section number
- `phraseIndex` - Current phrase within section
- `measureCount` - Total measures rendered
- `beatCount` - Total beats rendered
- `noteCount` - Total notes rendered

### Timestamps (ticks)
- `sectionStart` - Section start tick
- `phraseStart` - Phrase start tick
- `measureStart` - Measure start tick
- `beatStart` - Beat start tick
- `subdivStart` - Subdivision start tick

### Durations
- `tpSection` - Ticks per section
- `tpPhrase1/tpPhrase2` - Ticks per phrase (dual for variation)
- `spMeasure` - Seconds per measure
- `tpSec` - Ticks per second

### Rhythmic Parameters
- `numerator` - Current time signature numerator
- `meterRatio` - Meter scaling factor
- `divsPerBeat` - Divisions per beat (from composer)
- `subdivsPerDiv` - Subdivisions per division (from composer)
- `crossModulation` - Polyrhythmic interference factor

---

## Utility Functions (Re-exported from utils.ts)

### Clamping Functions
- `clamp(v, min, max)` - Hard clamp to range
- `modClamp(v, min, max)` - Modular wrapping clamp
- `softClamp(v, min, max)` - Smooth approach to boundaries

### Random Functions
- `rf()` - Random float 0-1
- `ri(min, max)` - Random integer in range
- `rv(base, variance)` - Random variation around base
- `rw(min, max, weights)` - Weighted random selection
- `ra(minMaxOrArray)` - Random from range or array element

### Random Objects
- `m` - Math utilities object (re-exported from utils.ts)

---

## Binaural Beat Support

### Pitch Bend Constants
- `neutralPitchBend = 8192` - Center pitch bend value
- `semitone = 4096` - One semitone in pitch bend units

### Binaural Variables
- `binauralFreqOffset` - Frequency offset for psychoacoustic beats
- `binauralPlus/binauralMinus` - High/low frequency adjustments
- `flipBin` - Toggle for alternating channel sets
- `beatsUntilBinauralShift` - Countdown to next channel flip

### Channel Flip Sets
- `flipBinT/flipBinF` - Primary binaural channel sets
- `flipBinT2/flipBinF2` - Secondary sets for smooth transitions
- `flipBinT3/flipBinF3` - Tertiary sets for complex patterns

---

## Channel Tracking

### Usage Sets
- `lastUsedCHs` - Set of recently used channels (avoids repetition)
- `lastUsedCHs2` - Secondary tracking for variation
- `lastUsedCHs3` - Tertiary tracking for complex routing

### Reflection Mapping
```typescript
reflect = {
  [cCH1]: cCH2,  // Center source → Center reflection
  [lCH1]: lCH3,  // Left 1 → Left reflection
  [rCH1]: rCH3,  // Right 1 → Right reflection
  [lCH2]: lCH4,  // Left 2 → Left reflection 2
  [rCH2]: rCH4   // Right 2 → Right reflection 2
}
```

---

## Integration Points

### With stage.ts ([code](../src/stage.ts)) ([doc](stage.md))

```typescript
import { source, reflection, bass, cCH1, drumCH } from './backstage';

// Use channel groups for note routing
stage.playNotesToChannels(notes, source);
stage.applyReflectionToChannels(source, reflection);
```

### With play.ts ([code](../src/play.ts)) ([doc](play.md))

```typescript
import { beatCount, measureCount, sectionIndex } from './backstage';

// Update counters during composition
beatCount++;
measureCount++;
```

### With utils.ts ([code](../src/utils.ts)) ([doc](utils.md))

```typescript
import { ri, rf, modClamp } from './backstage';

// Use re-exported utilities
const randomNote = ri(60, 72);
const wrappedValue = modClamp(value, 0, 12);
```

---

## Configuration Variables

- `velocity = 99` - Default MIDI note velocity
- `crossModulation = 2.2` - Polyrhythmic interference factor
- `lastMeter = [4, 4]` - Most recent time signature

---

## Related Modules

- [utils.ts](utils.md) - Actual utility implementations (re-exported here)
- [stage.ts](stage.md) - Uses channel constants for audio processing
- [play.ts](play.md) - Updates timing state during composition
- [time.ts](time.md) - Coordinates timing calculations
- [venue.ts](venue.md) - MIDI instrument and scale definitions

