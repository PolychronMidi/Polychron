# time.ts - Timing Calculation & Distribution Wrapper

> **Source**: `src/time.ts`  
> **Status**: Core Timing Utility  
> **Dependencies**: backstage.ts (BPM, PPQ), LayerManager, structure, rhythm helpers

## Overview

`time.ts` re-exports and wraps timing calculation functions from the `time/` subdirectory and backstage globals. It provides a unified API for calculating beat/division/subdivision timings, managing temporal distributions, and interfacing with the LayerManager for multi-layer timing coordination.

**Core Responsibilities:**
- Re-export timing functions from subdirectory modules (TimingCalculator, TimingContext, LayerManager)
- Provide helper functions for calculating time-per-beat, time-per-division, time-per-subdivision
- Manage temporal distribution calculations (on/off ratios, syncopation)
- Interface with LayerManager for multi-layer rendering
- Expose global timing constants (BPM, PPQ, tpBeat, tpDiv, etc.)

---

## API Highlights

This module primarily re-exports from subdirectory modules. Key exports include:

- `LayerManager` – Multi-layer MIDI timing and rendering coordination
- `TimingCalculator` – Converts BPM/PPQ to tick counts and time units
- `TimingContext` – Manages timing state across composition hierarchy

### Timing Constants (from backstage/globals)

- `BPM` – Beats per minute
- `PPQ` – Pulses per quarter note (MIDI resolution)
- `tpBeat` – Ticks per beat
- `tpDiv` – Ticks per division
- `tpSubdiv` – Ticks per subdivision
- `tpSec` – Ticks per second
- Similar variants for all timing levels

### Distribution Helpers

- `beatsOn`, `beatsOff` – Rhythm on/off counts at beat level
- `divsOn`, `divsOff` – Rhythm on/off counts at division level
- `subdivsOn`, `subdivsOff` – Rhythm on/off counts at subdivision level
- Used by PlayNotes for cross-modulation calculations

---

## Usage Example

```typescript
import { LayerManager } from '../src/time';

// LayerManager enables multi-layer composition:
const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => stage.setTuningAndInstruments());
const { state: poly, buffer: c2 } = LM.register('poly', 'c2', {}, () => stage.setTuningAndInstruments());

LM.activate('primary', false);
// ... composition loop for primary
LM.advance('primary', 'phrase');

LM.activate('poly', true);
// ... composition loop for poly
LM.advance('poly', 'phrase');
```

---

## Related Modules

- time/ subdirectory ([code](../src/time/)) ([doc](time/index.md)) - Detailed timing implementations
  - LayerManager.ts ([code](../src/time/LayerManager.ts)) ([doc](time/LayerManager.md)) - Multi-layer coordination
  - TimingCalculator.ts ([code](../src/time/TimingCalculator.ts)) ([doc](time/TimingCalculator.md)) - BPM/PPQ calculations
  - TimingContext.ts ([code](../src/time/TimingContext.ts)) ([doc](time/TimingContext.md)) - Timing state management
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Uses timing helpers in main loop
- rhythm.ts ([code](../src/rhythm.ts)) ([doc](rhythm.md)) - Generates patterns using timing divisions
- backstage.ts ([code](../src/backstage.ts)) ([doc](backstage.md)) - Provides BPM, PPQ, timing constants
