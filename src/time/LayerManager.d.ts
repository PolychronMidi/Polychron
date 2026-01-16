import { TimingContext } from './TimingContext';
/**
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 * Handles registration, activation, and advancement of timing layers.
 */
export declare const LayerManager: {
    layers: Record<string, {
        buffer: any;
        state: TimingContext;
    }>;
    activeLayer: string;
    /**
     * Register a layer with buffer and initial timing state.
     */
    register: (name: string, buffer: any, initialState?: Partial<TimingContext>, setupFn?: ((state: TimingContext, buf: any) => void) | null) => {
        state: TimingContext;
        buffer: any;
    };
    /**
     * Activate a layer; restores timing globals and sets meter.
     */
    activate: (name: string, isPoly?: boolean) => {
        phraseStart: number;
        phraseStartTime: number;
        sectionStart: number;
        sectionStartTime: number;
        sectionEnd: number;
        tpSec: number;
        tpSection: number;
        spSection: number;
        state: TimingContext;
    };
    /**
     * Advance a layer's timing state.
     */
    advance: (name: string, advancementType?: "phrase" | "section") => void;
};
//# sourceMappingURL=LayerManager.d.ts.map