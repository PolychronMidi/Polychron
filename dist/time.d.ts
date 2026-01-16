/**
 * Encapsulates meter spoofing and timing computations.
 * @class TimingCalculator
 * @param {object} options
 * @param {number} options.bpm - Beats per minute.
 * @param {number} options.ppq - Pulses per quarter note.
 * @param {[number, number]} options.meter - [numerator, denominator].
 */
declare class TimingCalculator {
    constructor({ bpm, ppq, meter }: {
        bpm: any;
        ppq: any;
        meter: any;
    });
    bpm: any;
    ppq: any;
    meter: any[];
    _getMidiTiming(): void;
    midiMeter: any[];
    meterRatio: number;
    midiMeterRatio: number;
    syncFactor: number;
    midiBPM: number;
    tpSec: number;
    tpMeasure: number;
    spMeasure: number;
}
declare let timingCalculator: any;
declare namespace LM {
    let layers: {};
    function register(name: string, buffer: CSVBuffer | string | any[], initialState?: object, setupFn?: Function): {
        state: TimingContext;
        buffer: CSVBuffer | any[];
    };
    function activate(name: string, isPoly?: boolean): {
        numerator: number;
        denominator: number;
        tpSec: number;
        tpMeasure: number;
    };
    function advance(name: string, advancementType?: "phrase" | "section"): void;
}
//# sourceMappingURL=time.d.ts.map