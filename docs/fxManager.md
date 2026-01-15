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
```javascript
fxManager.stutterFade(source2, 50, tpSec);
```

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
```javascript
fxManager.stutterPan(reflection);
```

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
```javascript
fxManager.stutterFX(bass, 40, tpSec * 1.5);
```

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
