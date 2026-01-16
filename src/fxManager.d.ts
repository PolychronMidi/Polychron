/**
 * FxManager class - Manages stutter effects (fade, pan, FX parameter changes) and channel state.
 * Tracks recently-used channels to avoid repetition; applies rapid automation to MIDI events.
 */
export declare class FxManager {
    private lastUsedCHs;
    private lastUsedCHs2;
    constructor();
    /**
     * Applies rapid volume stutter/fade effect to selected channels
     */
    stutterFade(channels: number[], numStutters?: number, duration?: number): void;
    /**
     * Applies rapid pan stutter effect to selected channels
     */
    stutterPan(channels: number[], numStutters?: number, duration?: number): void;
    /**
     * Applies rapid FX parameter stutter effect to selected channels
     */
    stutterFX(channels: number[], numStutters?: number, duration?: number): void;
    /**
     * Resets channel state tracking (clears lastUsedCHs and lastUsedCHs2)
     */
    resetChannelTracking(): void;
}
//# sourceMappingURL=fxManager.d.ts.map