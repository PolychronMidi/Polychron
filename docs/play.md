<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# play.ts - Main Composition Engine & Orchestrator

> **Status**: Core Orchestrator  
> **Dependencies**: All composer/timing/output/utility modules


## Overview

`play.ts` is the main composition engine that orchestrates the section→phrase→measure→beat hierarchy. It manages the global mutable state for composition nesting levels, initializes the DI container with core services, and drives the composition loop across all temporal divisions.

**Core Responsibilities:**
- Initialize the composition engine with DI container and core services
- Manage composition hierarchy (sections, phrases, measures, beats, divisions)
- Coordinate section profile resolution (type, dynamics, BPM scale, motifs)
- Orchestrate composer instantiation, measure timing, and polyrhythm generation
- Drive note rendering across all timing levels via `stage` methods
- Report composition progress through callback interface (phases, section counts)
- Support cancellation tokens for stopping long compositions
- Gradually migrate from global state to context-based architecture (ICompositionContext)

---

## Architecture

The composition loop follows this structure:

```
for each SECTION:
  resolve section profile (type, dynamics, phrasesPerSection)
  for each PHRASE in section:
    select composer (via registry)
    get meter from composer
    calculate MIDI timing and polyrhythm
    activate primary layer:
      for each MEASURE:
        for each BEAT:
          setup instruments/binaural/balance/FX
          play drums
          apply stutter FX/fades/pan
          for each DIVISION:
            for each SUBDIVISION:
              play melodic notes (playNotes)
            for each SUBSUBDIVISION:
              play secondary notes (playNotes2)
    activate poly layer (same as primary with playDrums2)
```

---

## API

### `initializePlayEngine(progressCallback?, cancellationToken?)`

Initialize the composition engine, register core services, create DI container, and optionally start composition.

**Parameters:**
- `progressCallback` – Optional callback to report composition phases (initializing, composing, rendering, complete) with progress 0-100
- `cancellationToken` – Optional CancellationToken to allow stopping composition mid-stream

**Returns:** Promise that resolves when composition is complete or rejects on error/cancellation

### Core Services Registered

The DI container registers:

- `config` (singleton) – BPM, SECTIONS, COMPOSERS configuration
- `eventBus` (singleton) – Event emission and listening
- `registry` (singleton) – ComposerRegistry for composer instantiation
- `fxManager` (singleton) – Stutter effects manager
- `stage` (singleton) – Audio/instrument setup and note playback
- `layerManager` (singleton) – Multi-layer timing and MIDI output
- `writers` (singleton) – CSV/MIDI output functions
- `compositionState` (singleton) – Shared state service
- All composer classes (MeasureComposer, ScaleComposer, ChordComposer, ModeComposer, PentatonicComposer)
- Music theory utilities (scales, chords, modes, MIDI conversions)

### Context Management (Gradual Migration)

Three helper functions support gradual migration from global state to context-based architecture:

- `setCurrentCompositionContext(ctx)` – Make context available to module functions
- `getCurrentCompositionContext()` – Get current context or null if no composition in progress
- `getContextValue(contextGetter, globalKey?)` – Retrieve value from context state with fallback to globals

### Global State Variables

The engine manages numerous global variables during composition (accessible via `currentCompositionContext.state`):

- `sectionIndex`, `totalSections` – Section nesting
- `phraseIndex`, `phrasesPerSection` – Phrase nesting
- `measureIndex`, `measuresPerPhrase` – Measure nesting
- `beatIndex`, `numerator`, `denominator` – Beat nesting
- `divIndex`, `divsPerBeat` – Division nesting
- `subdivIndex`, `subdivsPerDiv` – Subdivision nesting
- `subsubdivIndex`, `subsubsPerSub` – Sub-subdivision nesting
- `beatCount`, `measureCount` – Global counters
- `composer`, `activeMotif` – Current composer and motif
- `currentSectionType`, `currentSectionDynamics` – Section profile

---

## Usage Example

```typescript
import { initializePlayEngine } from '../src/play';

// Simple composition with progress tracking
await initializePlayEngine(
  (progress) => {
    console.log(`${progress.phase}: ${progress.message} (${progress.progress}%)`);
  }
);

// With cancellation support
const token = new CancellationToken();
const compositionPromise = initializePlayEngine(undefined, token);
setTimeout(() => token.cancel(), 10000); // Stop after 10s
await compositionPromise;
```

---

## Lifecycle Phases

Composition reports these phases via progress callback:

1. **initializing** (0%) – DI container setup, service registration, context creation
2. **composing** (5-90%) – Main composition loop with section-by-section progress
3. **rendering** (90%) – Finalization (grandFinale)
4. **complete** (100%) – Composition finished successfully

---

## Related Modules

- CompositionContext.ts ([code](../src/CompositionContext.ts)) ([doc](CompositionContext.md)) - Composition context interface and factory
- CompositionProgress.ts ([code](../src/CompositionProgress.ts)) ([doc](CompositionProgress.md)) - Progress tracking and cancellation
- DIContainer.ts ([code](../src/DIContainer.ts)) ([doc](DIContainer.md)) - Dependency injection
- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - Instrument/audio setup and note playback
- rhythm.ts ([code](../src/rhythm.ts)) ([doc](rhythm.md)) - Drum pattern generation and playback
- composers/ ([code](../src/composers/)) ([doc](composers.md)) - Composer implementations
