/**
 * Encapsulates meter spoofing and timing computations.
 * Converts non-power-of-2 denominators to MIDI-compatible meters.
 */
export declare class TimingCalculator {
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
    constructor({ bpm, ppq, meter }: {
        bpm: number;
        ppq: number;
        meter: [number, number];
    });
    private _getMidiTiming;
}
//# sourceMappingURL=TimingCalculator.d.ts.map