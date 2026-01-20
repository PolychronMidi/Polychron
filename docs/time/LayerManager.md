# LayerManager.ts - Multi-Layer Timing & Buffer Management

> **Status**: Timing Coordination System  
> **Dependencies**: TimingContext, CSVBuffer, backstage globals


## Overview

`LayerManager` (LM) coordinates multiple independent timing layers for simultaneous composition streams. It manages layer registration, activation, buffer switching, and timing state advancement. This enables rendering separate melodic/harmonic layers that progress independently but output to different MIDI buffers.

**Core Responsibilities:**
- Register named layers with timing contexts and MIDI buffers
- Activate/deactivate layers to switch timing state and output buffers
- Advance layer timing (phrase/section advancement)
- Save/restore timing state to/from globals
- Isolate timing contexts between layers while maintaining global state

---

## API

### `LayerManager` Object

Global singleton managing all composition layers.

#### Properties

- `layers` – Map of layer name → `{ buffer, state: TimingContext }`
- `activeLayer` – Currently active layer name

#### `register(name, buffer, initialState?, setupFn?)`

Register a new layer with timing context and optional setup function.

**Parameters:**
- `name` – Layer identifier (e.g., "primary", "poly")
- `buffer` – CSVBuffer instance, array, or string name
- `initialState` – Optional initial TimingContext values
- `setupFn` – Optional callback `(state, buffer) => void` for per-layer setup

**Returns:** `{ state, buffer }`

#### `activate(name, isPoly?)`

Activate a layer, switching timing globals and output buffer.

**Parameters:**
- `name` – Layer name to activate
- `isPoly` – If true, use polyrhythm timing (poly numerator/denominator)

**Returns:** Layer timing info (phrase/section start times, timing tree)

#### `advance(name, advancementType?)`

Advance layer timing for phrase or section completion.

**Parameters:**
- `name` – Layer name to advance
- `advancementType` – "phrase" (default) or "section"

---

## Two-Layer Pattern

Polychron typically uses two layers:

```typescript
// Register layers
const { state: primary, buffer: c1 } = LM.register('primary', 'c1', {}, () => 
  stage.setTuningAndInstruments()
);
const { state: poly, buffer: c2 } = LM.register('poly', 'c2', {}, () => 
  stage.setTuningAndInstruments()
);

// Primary layer (primary/main melody)
LM.activate('primary', false);
for (let measure = 0; measure < measuresPerPhrase; measure++) {
  stage.playNotes();
}
LM.advance('primary', 'phrase');

// Polyrhythm layer (secondary/harmony)
LM.activate('poly', true);
for (let measure = 0; measure < measuresPerPhrase2; measure++) {
  stage.playNotes();
}
LM.advance('poly', 'phrase');
```

---

## Related Modules

- time/TimingContext.ts ([code](../src/time/TimingContext.ts)) ([doc](time/TimingContext.md)) - Timing state container
- time/TimingCalculator.ts ([code](../src/time/TimingCalculator.ts)) ([doc](time/TimingCalculator.md)) - Timing calculations
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Uses LM for two-layer composition
- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - Writes to active layer buffer
- writer.ts ([code](../src/writer.ts)) ([doc](writer.md)) - Provides CSVBuffer
