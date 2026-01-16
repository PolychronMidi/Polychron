/**
 * MIDI event object structure
 */
interface MIDIEvent {
    tick: number;
    type: string;
    vals: any[];
}
/**
 * Layer-aware MIDI event buffer.
 */
export declare class CSVBuffer {
    name: string;
    rows: MIDIEvent[];
    constructor(name: string);
    push(...items: MIDIEvent[]): void;
    get length(): number;
    clear(): void;
}
/**
 * Push multiple items onto a buffer/array.
 */
export declare const pushMultiple: (buffer: CSVBuffer | any[], ...items: MIDIEvent[]) => void;
/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 */
export declare const logUnit: (type: string) => void;
/**
 * Outputs separate MIDI files for each layer with automatic synchronization.
 * Architecture:
 * - output1.csv/mid: Primary layer with its syncFactor
 * - output2.csv/mid: Poly layer with independent syncFactor
 * - output3.csv/mid+: Additional layers (when added)
 * - Phrase boundaries align perfectly in absolute time (seconds)
 * - Tick counts differ due to different tempo adjustments
 * - Automatically handles any number of layers
 */
export declare const grandFinale: () => void;
export {};
//# sourceMappingURL=writer.d.ts.map