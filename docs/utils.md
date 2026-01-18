<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# utils.ts - Core Utility Functions

> **Status**: Utility Helpers  
> **Dependencies**: Math utilities, random functions


## Overview

`utils.ts` exports common utility functions used throughout Polychron: random number generation (`rf`, `ri`, `ra`, `rv`, `rl`), clamping, modulo arithmetic, and probability helpers. These functions simplify common operations across the codebase and reduce redundancy.

**Core Responsibilities:**
- Provide random float/integer/array/variance/lerp functions
- Implement clamping and modulo utilities for MIDI/note bounds
- Expose probability and range helpers
- Offer variance and rounding utilities for algorithmic variation

---

## API Highlights

### Random Functions

- `rf(min, max)` – Random float in range [min, max)
- `ri(min, max)` – Random integer in range [min, max]
- `ra(array)` – Random element from array
- `rv(center, variance?, spread?, fallback?)` – Random value with variance around center
- `rl(current, minChange, maxChange, min, max)` – Lerp-based random walk with bounds

### Math Utilities

- `clamp(value, min, max)` – Constrain value to range
- `modClamp(value, min, max)` – Modulo-based clamping for octave wrapping
- `m` – Global Math object reference

### Probability

- `rf() < probability` – Common pattern for probabilistic branching

---

## Usage Example

```typescript
import { rf, ri, ra, clamp } from '../src/utils';

// Random tempo variation
const bpm = 120 + ri(-10, 10);

// Random element
const composer = ra([GenericComposer, MeasureComposer, ModeComposer]);

// Clamped note value
const noteInRange = clamp(randomNote, 0, 127);

// Probabilistic events
if (rf() < 0.3) {
  applyEffect();
}
```

---

## Related Modules

- backstage.ts ([code](../src/backstage.ts)) ([doc](backstage.md)) - Defines/re-exports utils
- All modules – Use utils for random/clamping operations
