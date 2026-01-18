# writer.ts - MIDI Output & CSV Export

> **Source**: `src/writer.ts`  
> **Status**: Output Engine  
> **Dependencies**: Global MIDI buffer, CSV conversion utilities

## Overview

`writer.ts` encapsulates MIDI output and CSV export functionality. It provides the main `p()` function for writing MIDI events to the global buffer, CSV serialization helpers, and output finalization (grandFinale). It acts as the final stage where composed note/CC events are persisted to files.

**Core Responsibilities:**
- Provide `p()` function for writing MIDI/CC events to global buffer
- Serialize MIDI events to CSV format
- Export MIDI files and CSV representations
- Handle finalization and cleanup (grandFinale)
- Support both primary and secondary output layers

---

## API Highlights

### Main Output Function

- `p(buffer, event)` – Write MIDI event to buffer
  - Event types: `note_on`, `note_off`, `cc` (CC/controller), `program_c`, `pitch_bend_c`
  - Automatically sorts by tick time

### CSV/Export Functions

- `addToCSV(...)` – Add event/note to CSV representation
- `emitMIDI(buffer)` – Finalize and emit MIDI file
- `grandFinale()` – Final output processing, file generation

### Event Format

```typescript
{
  tick: number;           // Time in MIDI ticks
  type: 'on' | 'off' | 'control_c' | 'program_c' | 'pitch_bend_c';
  vals: [channel, note, velocity?] | [channel, controller, value] | [channel, program];
}
```

---

## Usage Example

```typescript
import { p, grandFinale } from '../src/writer';

// During composition, emit notes
p(csvBuffer, {
  tick: 480,
  type: 'on',
  vals: [0, 60, 100]  // Channel 0, Middle C, velocity 100
});

p(csvBuffer, {
  tick: 480,
  type: 'control_c',
  vals: [0, 7, 127]   // Channel 0, Volume (CC7), max
});

// At end of composition
grandFinale();
```

---

## Related Modules

- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Orchestrates composition that writes events
- playNotes.ts ([code](../src/playNotes.ts)) ([doc](playNotes.md)) - Calls `p()` for note events
- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - Calls `p()` for CC/program events
- backstage.ts ([code](../src/backstage.ts)) ([doc](backstage.md)) - Global buffer and writer setup
