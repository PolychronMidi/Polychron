import { TimingCalculator } from './time/TimingCalculator';
import { TimingContext } from './time/TimingContext';
import { LayerManager } from './time/LayerManager';
export { TimingCalculator, TimingContext, LayerManager };
/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 */
declare const getMidiTiming: () => [number, number];
/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 */
declare const setMidiTiming: (tick?: number) => void;
/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 */
declare const getPolyrhythm: () => void;
/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position + index × duration pattern. See time.md for details.
 */
declare const setUnitTiming: (unitType: string) => void;
/**
 * Format seconds as MM:SS.ssss time string.
 */
declare const formatTime: (seconds: number) => string;
export { getMidiTiming, setMidiTiming, getPolyrhythm, setUnitTiming, formatTime };
//# sourceMappingURL=time.d.ts.map