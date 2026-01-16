"use strict";
// fxManager.js - Audio effects manager for stutter, pan, and FX parameter automation.
// Encapsulates fade, pan, and FX stutter effects with channel state tracking.
/**
 * FxManager class - Manages stutter effects (fade, pan, FX parameter changes) and channel state.
 * Tracks recently-used channels to avoid repetition; applies rapid automation to MIDI events.
 */
class FxManager {
    constructor() {
        // Channel tracking state for fade/pan/FX stutters
        this.lastUsedCHs = new Set(); // for stutterFade
        this.lastUsedCHs2 = new Set(); // for stutterPan and stutterFX
    }
    /**
     * Applies rapid volume stutter/fade effect to selected channels
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events (default: random 10-70)
     * @param {number} [duration] - Duration of stutter effect in ticks (default: tpSec * 0.2-1.5)
     * @returns {void}
     */
    stutterFade(channels, numStutters, duration) {
        const CHsToStutter = ri(1, 5);
        const channelsToStutter = new Set();
        const availableCHs = channels.filter(ch => !this.lastUsedCHs.has(ch));
        while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
            const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
            channelsToStutter.add(ch);
            availableCHs.splice(availableCHs.indexOf(ch), 1);
        }
        if (channelsToStutter.size < CHsToStutter) {
            this.lastUsedCHs.clear();
        }
        else {
            this.lastUsedCHs = new Set(channelsToStutter);
        }
        const channelsArray = Array.from(channelsToStutter);
        channelsArray.forEach(channelToStutter => {
            const maxVol = ri(90, 120);
            const isFadeIn = rf() < 0.5;
            let tick, volume;
            for (let i = m.floor(numStutters * (rf(1 / 3, 2 / 3))); i < numStutters; i++) {
                tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
                if (isFadeIn) {
                    volume = modClamp(m.floor(maxVol * (i / (numStutters - 1))), 25, maxVol);
                }
                else {
                    volume = modClamp(m.floor(100 * (1 - (i / (numStutters - 1)))), 25, 100);
                }
                p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 7, m.round(volume / rf(1.5, 5))] });
                p(c, { tick: tick + duration * rf(.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume] });
            }
            p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol] });
        });
    }
    /**
     * Applies rapid pan stutter effect to selected channels
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events (default: random 30-90)
     * @param {number} [duration] - Duration of stutter effect in ticks (default: tpSec * 0.1-1.2)
     * @returns {void}
     */
    stutterPan(channels, numStutters, duration) {
        const CHsToStutter = ri(1, 2);
        const channelsToStutter = new Set();
        const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));
        while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
            const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
            channelsToStutter.add(ch);
            availableCHs.splice(availableCHs.indexOf(ch), 1);
        }
        if (channelsToStutter.size < CHsToStutter) {
            this.lastUsedCHs2.clear();
        }
        else {
            this.lastUsedCHs2 = new Set(channelsToStutter);
        }
        const channelsArray = Array.from(channelsToStutter);
        channelsArray.forEach(channelToStutter => {
            const edgeMargin = ri(7, 25);
            const fullRange = 127 - edgeMargin;
            const centerZone = fullRange / 3;
            const leftBoundary = edgeMargin + centerZone;
            const rightBoundary = edgeMargin + 2 * centerZone;
            let currentPan = edgeMargin;
            let direction = 1;
            let tick;
            for (let i = m.floor(numStutters * rf(1 / 3, 2 / 3)); i < numStutters; i++) {
                tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
                if (currentPan >= rightBoundary)
                    direction = -1;
                else if (currentPan <= leftBoundary)
                    direction = 1;
                currentPan += direction * (fullRange / numStutters) * rf(.5, 1.5);
                currentPan = modClamp(m.floor(currentPan), edgeMargin, 127 - edgeMargin);
                p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 10, currentPan] });
            }
            p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
        });
    }
    /**
     * Applies rapid FX parameter stutter effect to selected channels
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events (default: random 30-100)
     * @param {number} [duration] - Duration of stutter effect in ticks (default: tpSec * 0.1-2)
     * @returns {void}
     */
    stutterFX(channels, numStutters, duration) {
        const CHsToStutter = ri(1, 2);
        const channelsToStutter = new Set();
        const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));
        while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
            const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
            channelsToStutter.add(ch);
            availableCHs.splice(availableCHs.indexOf(ch), 1);
        }
        if (channelsToStutter.size < CHsToStutter) {
            this.lastUsedCHs2.clear();
        }
        else {
            this.lastUsedCHs2 = new Set(channelsToStutter);
        }
        const channelsArray = Array.from(channelsToStutter);
        channelsArray.forEach(channelToStutter => {
            const startValue = ri(0, 127);
            const endValue = ri(0, 127);
            const ccParam = ra([91, 92, 93, 71, 74]);
            let tick;
            for (let i = m.floor(numStutters * rf(1 / 3, 2 / 3)); i < numStutters; i++) {
                tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
                const progress = i / (numStutters - 1);
                const currentValue = m.floor(startValue + (endValue - startValue) * progress);
                p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, currentValue] });
            }
            p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, 64] });
        });
    }
    /**
     * Resets channel state tracking (clears lastUsedCHs and lastUsedCHs2)
     * @returns {void}
     */
    resetChannelTracking() {
        this.lastUsedCHs.clear();
        this.lastUsedCHs2.clear();
    }
}
// Export FxManager instance and class to global namespace
globalThis.fxManager = new FxManager();
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, { fxManager: globalThis.fxManager, FxManager });
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FxManager;
}
//# sourceMappingURL=fxManager.js.map
