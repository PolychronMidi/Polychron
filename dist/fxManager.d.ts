export = FxManager;
/**
 * FxManager class - Manages stutter effects (fade, pan, FX parameter changes) and channel state.
 * Tracks recently-used channels to avoid repetition; applies rapid automation to MIDI events.
 */
declare class FxManager {
    lastUsedCHs: Set<any>;
    lastUsedCHs2: Set<any>;
    /**
     * Applies rapid volume stutter/fade effect to selected channels
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events (default: random 10-70)
     * @param {number} [duration] - Duration of stutter effect in ticks (default: tpSec * 0.2-1.5)
     * @returns {void}
     */
    stutterFade(channels: any[], numStutters?: number, duration?: number): void;
    /**
     * Applies rapid pan stutter effect to selected channels
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events (default: random 30-90)
     * @param {number} [duration] - Duration of stutter effect in ticks (default: tpSec * 0.1-1.2)
     * @returns {void}
     */
    stutterPan(channels: any[], numStutters?: number, duration?: number): void;
    /**
     * Applies rapid FX parameter stutter effect to selected channels
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events (default: random 30-100)
     * @param {number} [duration] - Duration of stutter effect in ticks (default: tpSec * 0.1-2)
     * @returns {void}
     */
    stutterFX(channels: any[], numStutters?: number, duration?: number): void;
    /**
     * Resets channel state tracking (clears lastUsedCHs and lastUsedCHs2)
     * @returns {void}
     */
    resetChannelTracking(): void;
}
//# sourceMappingURL=fxManager.d.ts.map