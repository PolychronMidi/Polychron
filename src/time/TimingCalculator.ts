// TimingCalculator.ts - Meter spoofing and base duration math.
// minimalist comments, details at: time.md

/**
 * Encapsulates meter spoofing and timing computations.
 * Converts non-power-of-2 denominators to MIDI-compatible meters.
 */
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

// Export to global namespace for tests and backward compatibility
(globalThis as any).TimingCalculator = TimingCalculator;
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__POLYCHRON_TEST__ = (globalThis as any).__POLYCHRON_TEST__ || {};
  (globalThis as any).__POLYCHRON_TEST__.TimingCalculator = TimingCalculator;
}
