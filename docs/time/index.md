<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# time/ – Timing Module Index

> **Subdirectory**: `src/time/`  
> **Status**: Timing Subsystem  
> **Dependencies**: Backstage globals, MIDI utilities


## Overview

The `time/` subdirectory contains the core timing calculation, state management, and multi-layer coordination system. These modules work together to:

- Calculate MIDI-compatible timings from arbitrary meters
- Manage per-layer timing contexts
- Coordinate multi-layer rendering with independent timing
- Support polyrhythms and non-power-of-2 time signatures

---

## Modules

### LayerManager.ts

Multi-layer timing coordination and buffer switching.

- **File**: [LayerManager.ts](../src/time/LayerManager.ts)
- **Doc**: [LayerManager.md](LayerManager.md)
- **Purpose**: Register, activate, and advance composition layers
- **Key API**: `LayerManager.register()`, `activate()`, `advance()`

### TimingCalculator.ts

Meter conversion and timing math for arbitrary time signatures.

- **File**: [TimingCalculator.ts](../src/time/TimingCalculator.ts)
- **Doc**: [TimingCalculator.md](TimingCalculator.md)
- **Purpose**: Handle non-power-of-2 meters via meter spoofing
- **Key API**: Timing constants (tpMeasure, tpSec, syncFactor)

### TimingContext.ts

Per-layer timing state container and management.

- **File**: [TimingContext.ts](../src/time/TimingContext.ts)
- **Doc**: [TimingContext.md](TimingContext.md)
- **Purpose**: Encapsulate hierarchical timing state for each layer
- **Key API**: `saveFrom()`, `restoreTo()`, `advancePhrase()`, `advanceSection()`

---

## Architecture

```
LayerManager (coordinator)
  ├─ Layer "primary"
  │  └─ TimingContext (timing state)
  │     └─ TimingCalculator (meter math)
  │
  └─ Layer "poly"
     └─ TimingContext (timing state)
        └─ TimingCalculator (meter math)
```

---

## Usage Pattern

```typescript
import { LayerManager } from '../src/time/LayerManager';

// Register layers with timing contexts
const { state: primary, buffer: c1 } = LayerManager.register('primary', 'c1');
const { state: poly, buffer: c2 } = LayerManager.register('poly', 'c2');

// Compose primary layer
LayerManager.activate('primary', false);
for (let i = 0; i < phrases; i++) {
  stage.playNotes();
}
LayerManager.advance('primary', 'phrase');

// Compose poly layer independently
LayerManager.activate('poly', true);
for (let i = 0; i < phrases; i++) {
  stage.playNotes();
}
LayerManager.advance('poly', 'phrase');
```

---

## Related Modules

- play.ts ([code](../src/play.ts)) ([doc](../play.md)) - Orchestrates multi-layer composition
- CompositionContext.ts ([code](../src/CompositionContext.ts)) ([doc](../CompositionContext.md)) - Higher-level context wrapper
- backstage.ts ([code](../src/backstage.ts)) ([doc](../backstage.md)) - Global timing constants
