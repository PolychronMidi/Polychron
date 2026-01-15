# FxManager - Audio Effects Automation

FxManager is a utility class that encapsulates MIDI stutter effects and channel state tracking. It provides automated fade, pan, and FX parameter modulation for dynamic audio processing.

## Overview

FxManager manages three types of stutter effects applied to MIDI channels:
- **Fade Stutter**: Rapid volume (CC7) automation with fade-in or fade-out envelopes
- **Pan Stutter**: Rapid pan (CC10) sweeps across the stereo field
- **FX Stutter**: Rapid FX parameter (CC91-95, CC71, CC74) automation with value interpolation

Channel state is tracked to avoid immediate repetition of effects on the same channels.

## API

### Constructor
```javascript
new FxManager()
```
Creates a new FxManager with empty channel tracking sets.

### Methods

#### `stutterFade(channels, numStutters, duration)`
Applies rapid volume stutter/fade to selected channels.

**Parameters:**
- `channels` (Array<number>): Channel numbers to potentially stutter
- `numStutters` (number, optional): Number of stutter events (default: ri(10,70))
- `duration` (number, optional): Duration in ticks (default: tpSec * rf(0.2,1.5))

**Behavior:**
- Selects 1-5 random channels from input that haven't been recently used
- Applies either fade-in or fade-out envelope
- Updates CC7 (volume) with stochastic offsets and delays
- Resets to max volume at end of effect

**Example:**
<!-- BEGIN: snippet:FxManager_stutterFade -->

```javascript
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
    } else {
      this.lastUsedCHs = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach(channelToStutter => {
      const maxVol = ri(90, 120);
      const isFadeIn = rf() < 0.5;
      let tick, volume;

      for (let i = m.floor(numStutters * (rf(1/3, 2/3))); i < numStutters; i++) {
        tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
        if (isFadeIn) {
          volume = modClamp(m.floor(maxVol * (i / (numStutters - 1))), 25, maxVol);
        } else {
          volume = modClamp(m.floor(100 * (1 - (i / (numStutters - 1)))), 25, 100);
        }
        p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 7, m.round(volume / rf(1.5, 5))] });
        p(c, { tick: tick + duration * rf(.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume] });
      }
      p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol] });
    });
  }
```

<!-- END: snippet:FxManager_stutterFade -->

---

#### `stutterPan(channels, numStutters, duration)`
Applies rapid pan stutter to selected channels.

**Parameters:**
- `channels` (Array<number>): Channel numbers to potentially stutter
- `numStutters` (number, optional): Number of stutter events (default: ri(30,90))
- `duration` (number, optional): Duration in ticks (default: tpSec * rf(0.1,1.2))

**Behavior:**
- Selects 1-2 random channels that haven't been recently used
- Sweeps pan (CC10) within a constrained range (edge margin + 3-zone system)
- Oscillates direction based on boundary crossings
- Returns to center pan (64) at end

**Example:**
<!-- BEGIN: snippet:FxManager_stutterPan -->

```javascript
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
    } else {
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

      for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
        tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
        if (currentPan >= rightBoundary) direction = -1;
        else if (currentPan <= leftBoundary) direction = 1;
        currentPan += direction * (fullRange / numStutters) * rf(.5, 1.5);
        currentPan = modClamp(m.floor(currentPan), edgeMargin, 127 - edgeMargin);
        p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 10, currentPan] });
      }
      p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
    });
  }
```

<!-- END: snippet:FxManager_stutterPan -->

---

#### `stutterFX(channels, numStutters, duration)`
Applies rapid FX parameter stutter to selected channels.

**Parameters:**
- `channels` (Array<number>): Channel numbers to potentially stutter
- `numStutters` (number, optional): Number of stutter events (default: ri(30,100))
- `duration` (number, optional): Duration in ticks (default: tpSec * rf(0.1,2))

**Behavior:**
- Selects 1-2 random channels that haven't been recently used
- Randomly chooses FX parameter: CC91, 92, 93, 71, or 74
- Interpolates from random start to random end value
- Returns to center (64) at end

**Example:**
<!-- BEGIN: snippet:FxManager_stutterFX -->

```javascript
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
    } else {
      this.lastUsedCHs2 = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach(channelToStutter => {
      const startValue = ri(0, 127);
      const endValue = ri(0, 127);
      const ccParam = ra([91, 92, 93, 71, 74]);
      let tick;

      for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
        tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
        const progress = i / (numStutters - 1);
        const currentValue = m.floor(startValue + (endValue - startValue) * progress);
        p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, currentValue] });
      }
      p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, 64] });
    });
  }
```

<!-- END: snippet:FxManager_stutterFX -->

---

#### `resetChannelTracking()`
Clears all channel state tracking.

**Example:**
```javascript
fxManager.resetChannelTracking();
```

## Integration

FxManager is instantiated globally and used by the [Stage](stage.md) class:

```javascript
require('./fxManager');

class Stage {
  constructor() {
    this.fx = fxManager;  // Use global instance
  }

  stutterFade(channels, numStutters, duration) {
    this.fx.stutterFade(channels, numStutters, duration);
  }
}
```

## Channel Tracking

FxManager maintains two sets of recently-used channels:
- `lastUsedCHs`: Tracks fade stutter usage
- `lastUsedCHs2`: Tracks pan and FX stutter usage

This prevents rapid re-application of the same effect to a channel, enhancing musical variety.

When a stutter effect cannot find enough new channels (due to reuse), the tracking set is cleared to reset the history.

## Global Access

```javascript
// FxManager is available globally after requiring fxManager.js
globalThis.fxManager
```

## Related

- [Stage](stage.md) - Audio processing engine that uses FxManager
- [Sheet Configuration](sheet.md) - Channel definitions (source, reflection, bass, etc.)
- [Venue](venue.md) - Global MIDI constants and channel routing
