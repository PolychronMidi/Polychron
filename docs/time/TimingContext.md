<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# TimingContext.ts - Layer-Level Timing State Container

> **Status**: Timing State Management  
> **Dependencies**: TimingCalculator helpers, backstage globals


## Overview

`TimingContext` encapsulates all timing-related state for a single composition layer (phrase/measure/beat timing, polyrhythm ratios, on/off counts, tempo). Each layer maintains its own TimingContext instance, allowing independent timing progression while writing to separate MIDI buffers.

**Core Responsibilities:**
- Store hierarchical timing state (section/phrase/measure/beat levels)
- Track on/off rhythm counts at each level
- Maintain polyrhythm ratios and divisors
- Save/restore timing state to/from globals
- Support meter, BPM, and timing parameter updates

---

## API

### `class TimingContext`

Per-layer timing state container.

<!-- BEGIN: snippet:TimingContext -->

```typescript
export class TimingContext {
  phraseStart: number;
  phraseStartTime: number;
  sectionStart: number;
  sectionStartTime: number;
  sectionEnd: number;
  tpSec: number;
  tpSection: number;
  spSection: number;
  numerator: number;
  denominator: number;
  measuresPerPhrase: number;
  tpPhrase: number;
  spPhrase: number;
  measureStart: number;
  measureStartTime: number;
  tpMeasure: number;
  spMeasure: number;
  meterRatio: number;
  bufferName: string;
  buffer?: any; // CSVBuffer or Array

  constructor(initialState: Partial<TimingContext> = {}) {
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
    this.tpMeasure = initialState.tpMeasure || (typeof g.PPQ !== 'undefined' ? g.PPQ * 4 : 480 * 4);
    this.spMeasure = initialState.spMeasure || 0;
    this.meterRatio = initialState.meterRatio || (this.numerator / this.denominator);
    this.bufferName = initialState.bufferName || '';
  }

  /**
   * Save timing values from globals object.
   */
  saveFrom(globals: any): void {
    this.phraseStart = globals.phraseStart;
    this.phraseStartTime = globals.phraseStartTime;
    this.sectionStart = globals.sectionStart;
    this.sectionStartTime = globals.sectionStartTime;
    this.sectionEnd = globals.sectionEnd;
    this.tpSec = globals.tpSec;
    this.tpSection = globals.tpSection;
    this.spSection = globals.spSection;
    this.numerator = globals.numerator;
    this.denominator = globals.denominator;
    this.measuresPerPhrase = globals.measuresPerPhrase;
    this.tpPhrase = globals.tpPhrase;
    this.spPhrase = globals.spPhrase;
    this.measureStart = globals.measureStart;
    this.measureStartTime = globals.measureStartTime;
    this.tpMeasure = globals.tpMeasure;
    this.spMeasure = globals.spMeasure;
    this.meterRatio = globals.numerator / globals.denominator;
  }

  /**
   * Restore timing values to globals object.
   */
  restoreTo(globals: any): void {
    globals.phraseStart = this.phraseStart;
    globals.phraseStartTime = this.phraseStartTime;
    globals.sectionStart = this.sectionStart;
    globals.sectionStartTime = this.sectionStartTime;
    globals.sectionEnd = this.sectionEnd;
    globals.tpSec = this.tpSec;
    globals.tpSection = this.tpSection;
    globals.spSection = this.spSection;
    globals.tpPhrase = this.tpPhrase;
    globals.spPhrase = this.spPhrase;
    globals.measureStart = this.measureStart;
    globals.measureStartTime = this.measureStartTime;
    globals.tpMeasure = this.tpMeasure;
    globals.spMeasure = this.spMeasure;
  }

  /**
   * Advance phrase timing.
   */
  advancePhrase(tpPhrase: number, spPhrase: number): void {
    this.phraseStart += tpPhrase;
    this.phraseStartTime += spPhrase;
    this.tpSection += tpPhrase;
    this.spSection += spPhrase;
  }

  /**
   * Advance section timing.
   */
  advanceSection(): void {
    this.sectionStart += this.tpSection;
    this.sectionStartTime += this.spSection;
    this.sectionEnd += this.tpSection;
    this.tpSection = 0;
    this.spSection = 0;
  }
}
```

<!-- END: snippet:TimingContext -->

#### Constructor

```typescript
constructor(initialState?: Partial<TimingContext>)
```

Create a new timing context, optionally initialized with state values.

#### Key Methods

- `saveFrom(values)` – Capture timing values from globals or objects
- `restoreTo(target)` – Restore all timing values to target (usually globalThis)
- `updateMeter(numerator, denominator)` – Recalculate timings for new meter
- `advancePhrase(tpPhrase, spPhrase)` – Advance phrase timing
- `advanceSection()` – Advance section timing

#### State Properties

**Hierarchy Timing:**
- `sectionStart`, `sectionStartTime` – Section boundaries
- `phraseStart`, `phraseStartTime` – Phrase boundaries
- `measureStart`, `measureStartTime` – Measure boundaries
- `beatStart` – Beat tick position
- `subdivStart`, `subsubdivStart` – Subdivision positions

**Meter & Tempo:**
- `numerator`, `denominator` – Time signature
- `meterRatio` – numerator / denominator
- `bpm`, `midiBPM` – Tempos (original and MIDI-adjusted)

**Timing Constants:**
- `tpBeat`, `tpDiv`, `tpSubdiv`, `tpSubsubdiv` – Ticks per level
- `spBeat`, `spDiv`, `spSubdiv` – Seconds per level
- `tpMeasure`, `spMeasure` – Measure timing
- `tpPhrase`, `spPhrase` – Phrase timing
- `tpSection`, `spSection` – Section timing
- `tpSec` – Ticks per second

**Polyrhythm:**
- `polyNumerator`, `polyDenominator` – Polyrhythm meter
- `measuresPerPhrase`, `measuresPerPhrase1/2` – Phrase lengths per layer
- `divsPerBeat`, `subdivsPerDiv`, `subsubsPerSub` – Subdivision divisors

**Rhythm On/Off:**
- `beatsOn`, `beatsOff`, `beatsUntilBinauralShift` – Beat rhythm
- `divsOn`, `divsOff` – Division rhythm
- `subdivsOn`, `subdivsOff` – Subdivision rhythm
- `subsubdivRhythm` – Sub-subdivision rhythm

**Other:**
- `velocity`, `bpmRatio3` – Velocity and tempo ratio
- `buffer`, `bufferName` – Associated MIDI buffer

---

## Usage Example

```typescript
import { TimingContext } from '../src/time/TimingContext';

// Create context for a layer
const ctx = new TimingContext({
  bpm: 120,
  ppq: 480,
  numerator: 4,
  denominator: 4
});

// Update meter (recalculates all timing)
ctx.updateMeter(5, 4);

// Save timing from globals
ctx.saveFrom({
  beatStart: 480,
  phraseStart: 0,
  numerator: 4
});

// Restore to globals
ctx.restoreTo(globalThis);

// Advance timing
ctx.advancePhrase(960, 4);  // tpPhrase, spPhrase
```

---

## Related Modules

- time/LayerManager.ts ([code](../src/time/LayerManager.ts)) ([doc](time/LayerManager.md)) - Creates/activates contexts
- time/TimingCalculator.ts ([code](../src/time/TimingCalculator.ts)) ([doc](time/TimingCalculator.md)) - Calculates timing constants
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Uses contexts during composition
- CompositionContext.ts ([code](../src/CompositionContext.ts)) ([doc](CompositionContext.md)) - Higher-level context wrapper
