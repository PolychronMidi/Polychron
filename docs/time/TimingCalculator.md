<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# TimingCalculator.ts - Meter Conversion & Timing Computations

> **Status**: Timing Math Utility  
> **Dependencies**: None (pure math)


## Overview

`TimingCalculator` handles the conversion between arbitrary time signatures (including non-power-of-2 denominators) and MIDI-compatible meters. It calculates all timing constants (ticks per measure, ticks per second, sync factors) needed for accurate MIDI rendering.

**Core Responsibilities:**
- Convert arbitrary meter (e.g., 5/7, 7/8) to closest MIDI-compatible meter
- Calculate sync factors between requested and MIDI meters
- Compute timing constants: ticks-per-measure, ticks-per-second, sample-per-measure
- Validate BPM/PPQ/meter inputs
- Support arbitrary non-power-of-2 denominators with minimal timing drift

---

## API

### `class TimingCalculator`

Meter spoofing and timing computation engine.

<!-- BEGIN: snippet:TimingCalculator -->

```typescript
export class TimingCalculator {
  bpm: number;
  ppq: number;
  meter: [number, number];
  midiMeter: [number, number];
  meterRatio: number;
  midiMeterRatio: number;
  syncFactor: number;
  midiBPM: number;
  tpSec: number;
  tpMeasure: number;
  spMeasure: number;

  constructor({ bpm, ppq, meter }: { bpm: number; ppq: number; meter: [number, number] }) {
    const [num, den] = meter || [];
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
      throw new Error(`Invalid meter: ${num}/${den}`);
    }
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error(`Invalid BPM: ${bpm}`);
    }
    if (!Number.isFinite(ppq) || ppq <= 0) {
      throw new Error(`Invalid PPQ: ${ppq}`);
    }
    this.bpm = bpm;
    this.ppq = ppq;
    this.meter = [num, den];
    this.midiMeter = [num, den];
    this.meterRatio = 0;
    this.midiMeterRatio = 0;
    this.syncFactor = 0;
    this.midiBPM = 0;
    this.tpSec = 0;
    this.tpMeasure = 0;
    this.spMeasure = 0;
    this._getMidiTiming();
  }

  private _getMidiTiming(): void {
    const [num, den] = this.meter;
    const isPow2 = (n: number): boolean => (n & (n - 1)) === 0;
    if (isPow2(den)) {
      this.midiMeter = [num, den];
    } else {
      const hi = 2 ** Math.ceil(Math.log2(den));
      const lo = 2 ** Math.floor(Math.log2(den));
      const ratio = num / den;
      this.midiMeter = Math.abs(ratio - num / hi) < Math.abs(ratio - num / lo)
        ? [num, hi]
        : [num, lo];
    }
    this.meterRatio = num / den;
    this.midiMeterRatio = this.midiMeter[0] / this.midiMeter[1];
    this.syncFactor = this.midiMeterRatio / this.meterRatio;
    this.midiBPM = this.bpm * this.syncFactor;
    this.tpSec = this.midiBPM * this.ppq / 60;
    this.tpMeasure = this.ppq * 4 * this.midiMeterRatio;
    this.spMeasure = (60 / this.bpm) * 4 * this.meterRatio;
  }
}
```

<!-- END: snippet:TimingCalculator -->

#### Constructor

```typescript
constructor(options: {
  bpm: number;              // Beats per minute
  ppq: number;              // Pulses per quarter note (MIDI resolution, typically 480)
  meter: [number, number];  // [numerator, denominator] (e.g., [4, 4], [5, 7])
})
```

**Throws:** Error if BPM, PPQ, or meter are invalid.

#### Properties

- `bpm` – Original beats per minute
- `ppq` – Pulses per quarter note (MIDI resolution)
- `meter` – Original [numerator, denominator]
- `midiMeter` – MIDI-compatible meter (always power-of-2 denominator)
- `meterRatio` – Original numerator / denominator
- `midiMeterRatio` – MIDI numerator / denominator
- `syncFactor` – midiMeterRatio / meterRatio (for timing adjustment)
- `midiBPM` – BPM adjusted for MIDI meter (bpm * syncFactor)
- `tpSec` – Ticks per second (midiBPM * ppq / 60)
- `tpMeasure` – Ticks per measure (ppq * 4 * midiMeterRatio)
- `spMeasure` – Seconds per measure (60 / bpm * 4 * meterRatio)

#### Meter Spoofing

If the requested meter has a non-power-of-2 denominator (e.g., 5/7):

1. Find nearest power-of-2 denominators above and below (8, 4)
2. Calculate ratios for both candidates
3. Choose the closest match (minimizes timing drift)
4. Calculate sync factor to compensate for meter mismatch

Example: 5/7 → closest is 5/8 (or 5/4 depending on ratio)

---

## Usage Example

```typescript
import { TimingCalculator } from '../src/time/TimingCalculator';

const calc = new TimingCalculator({
  bpm: 120,
  ppq: 480,
  meter: [5, 7]  // Non-standard meter
});

console.log(calc.midiMeter);      // [5, 8] - MIDI-compatible meter
console.log(calc.syncFactor);     // ~0.914 - tempo adjustment
console.log(calc.midiBPM);        // ~110 - adjusted tempo
console.log(calc.tpMeasure);      // Ticks per measure
console.log(calc.tpSec);          // Ticks per second
```

---

## Related Modules

- time/TimingContext.ts ([code](../src/time/TimingContext.ts)) ([doc](time/TimingContext.md)) - Uses calculator results
- time/LayerManager.ts ([code](../src/time/LayerManager.ts)) ([doc](time/LayerManager.md)) - Manages calculator instances per layer
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Creates calculator for each section meter
- backstage.ts ([code](../src/backstage.ts)) ([doc](backstage.md)) - BPM/PPQ configuration source
