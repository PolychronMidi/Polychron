"use strict";
// fxManager.ts - Audio effects manager for stutter, pan, and FX parameter automation.
// Encapsulates fade, pan, and FX stutter effects with channel state tracking.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fxManager = exports.FxManager = void 0;
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
     */
    stutterFade(channels, numStutters, duration) {
        const g = globalThis;
        numStutters = numStutters || g.ri(10, 70);
        duration = duration || g.tpSec * g.rf(0.2, 1.5);
        const CHsToStutter = g.ri(1, 5);
        const channelsToStutter = new Set();
        const availableCHs = channels.filter(ch => !this.lastUsedCHs.has(ch));
        while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
            const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
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
        channelsArray.forEach((channelToStutter) => {
            const maxVol = g.ri(90, 120);
            const isFadeIn = g.rf() < 0.5;
            let tick, volume;
            for (let i = Math.floor(numStutters * g.rf(1 / 3, 2 / 3)); i < numStutters; i++) {
                tick = g.beatStart + (i * (duration / numStutters) * g.rf(0.9, 1.1));
                if (isFadeIn) {
                    volume = g.modClamp(Math.floor(maxVol * (i / (numStutters - 1))), 25, maxVol);
                }
                else {
                    volume = g.modClamp(Math.floor(100 * (1 - i / (numStutters - 1))), 25, 100);
                }
                g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, 7, Math.round(volume / g.rf(1.5, 5))] });
                g.p(g.c, { tick: tick + duration * g.rf(0.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume] });
            }
            g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol] });
        });
    }
    /**
     * Applies rapid pan stutter effect to selected channels
     */
    stutterPan(channels, numStutters, duration) {
        const g = globalThis;
        numStutters = numStutters || g.ri(30, 90);
        duration = duration || g.tpSec * g.rf(0.1, 1.2);
        const CHsToStutter = g.ri(1, 2);
        const channelsToStutter = new Set();
        const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));
        while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
            const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
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
        channelsArray.forEach((channelToStutter) => {
            const edgeMargin = g.ri(7, 25);
            const fullRange = 127 - edgeMargin;
            const centerZone = fullRange / 3;
            const leftBoundary = edgeMargin + centerZone;
            const rightBoundary = edgeMargin + 2 * centerZone;
            let currentPan = edgeMargin;
            let direction = 1;
            let tick;
            for (let i = Math.floor(numStutters * g.rf(1 / 3, 2 / 3)); i < numStutters; i++) {
                tick = g.beatStart + (i * (duration / numStutters) * g.rf(0.9, 1.1));
                if (currentPan >= rightBoundary) {
                    direction = -1;
                }
                else if (currentPan <= leftBoundary) {
                    direction = 1;
                }
                currentPan += direction * (fullRange / numStutters) * g.rf(0.5, 1.5);
                currentPan = g.modClamp(Math.floor(currentPan), edgeMargin, 127 - edgeMargin);
                g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, 10, currentPan] });
            }
            g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
        });
    }
    /**
     * Applies rapid FX parameter stutter effect to selected channels
     */
    stutterFX(channels, numStutters, duration) {
        const g = globalThis;
        numStutters = numStutters || g.ri(30, 100);
        duration = duration || g.tpSec * g.rf(0.1, 2);
        const CHsToStutter = g.ri(1, 2);
        const channelsToStutter = new Set();
        const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));
        while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
            const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
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
        channelsArray.forEach((channelToStutter) => {
            const startValue = g.ri(0, 127);
            const endValue = g.ri(0, 127);
            const ccParam = g.ra([91, 92, 93, 71, 74]);
            let tick;
            for (let i = Math.floor(numStutters * g.rf(1 / 3, 2 / 3)); i < numStutters; i++) {
                tick = g.beatStart + (i * (duration / numStutters) * g.rf(0.9, 1.1));
                const progress = i / (numStutters - 1);
                const currentValue = Math.floor(startValue + (endValue - startValue) * progress);
                g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, currentValue] });
            }
            g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, 64] });
        });
    }
    /**
     * Resets channel state tracking (clears lastUsedCHs and lastUsedCHs2)
     */
    resetChannelTracking() {
        this.lastUsedCHs.clear();
        this.lastUsedCHs2.clear();
    }
}
exports.FxManager = FxManager;
// Create and export instance to global scope
const fxManager = new FxManager();
exports.fxManager = fxManager;
globalThis.FxManager = FxManager;
globalThis.fxManager = fxManager;
// Export for tests
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    globalThis.__POLYCHRON_TEST__.FxManager = FxManager;
    globalThis.__POLYCHRON_TEST__.fxManager = fxManager;
}
//# sourceMappingURL=fxManager.js.map