/**
 * TimingContext class - encapsulates all timing state for a layer.
 * Provides methods to save/restore timing state and advance timing.
 */
export declare class TimingContext {
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
    buffer?: any;
    constructor(initialState?: Partial<TimingContext>);
    /**
     * Save timing values from globals object.
     */
    saveFrom(globals: any): void;
    /**
     * Restore timing values to globals object.
     */
    restoreTo(globals: any): void;
    /**
     * Advance phrase timing.
     */
    advancePhrase(tpPhrase: number, spPhrase: number): void;
    /**
     * Advance section timing.
     */
    advanceSection(): void;
}
//# sourceMappingURL=TimingContext.d.ts.map