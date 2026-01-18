# fxManager.ts - Stutter/FX Automation Manager

> **Source**: `src/fxManager.ts`  
> **Status**: Core FX Utility  
> **Dependencies**: Global timing helpers (tpSec, beatStart), MIDI writer `p`

## Overview

`fxManager.ts` encapsulates rapid stutter effects for volume, pan, and FX parameters, keeping recent channel usage to avoid repetition. It emits MIDI CC events to drive fades, pans, and FX automation and exposes a singleton instance.

**Core Responsibilities:**
- Apply stutter fades on volume (CC7) with randomized patterns
- Apply pan stutters (CC10) within safe boundaries
- Apply FX parameter stutters across common CC targets
- Track recent channels to reduce reuse and allow resets

## Architecture Role

- Used during rendering to add micro FX motion on selected MIDI channels
- Provides reusable singleton `fxManager` plus class for testing/custom flows

---

## API

### `class FxManager`

Stutter effect engine with channel tracking.

<!-- BEGIN: snippet:FxManager -->

```typescript
class FxManager {
  private lastUsedCHs: Set<number>;
  private lastUsedCHs2: Set<number>;

  constructor() {
    // Channel tracking state for fade/pan/FX stutters
    this.lastUsedCHs = new Set(); // for stutterFade
    this.lastUsedCHs2 = new Set(); // for stutterPan and stutterFX
  }

  /**
   * Applies rapid volume stutter/fade effect to selected channels
   */
  stutterFade(channels: number[], numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    numStutters = numStutters || g.ri(10, 70);
    duration = duration || g.tpSec * g.rf(0.2, 1.5);

    const CHsToStutter = g.ri(1, 5);
    const channelsToStutter = new Set<number>();
    const availableCHs = channels.filter(ch => !this.lastUsedCHs.has(ch));

    while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
      const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
      channelsToStutter.add(ch);
      availableCHs.splice(availableCHs.indexOf(ch), 1);
    }

    if (channelsToStutter.size < CHsToStutter) {
      this.lastUsedCHs.clear();
    } else {
      this.lastUsedCHs = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach((channelToStutter: number) => {
      const maxVol = g.ri(90, 120);
      const isFadeIn = g.rf() < 0.5;
      const effectiveNumStutters = numStutters ?? 4; // Default value
      let tick: number = g.beatStart; // Initialize with default
      let volume: number;

      for (let i = Math.floor(effectiveNumStutters * g.rf(1 / 3, 2 / 3)); i < effectiveNumStutters; i++) {
        tick = g.beatStart + (i * (duration / effectiveNumStutters) * g.rf(0.9, 1.1));
        if (isFadeIn) {
          volume = g.modClamp(Math.floor(maxVol * (i / (effectiveNumStutters - 1))), 25, maxVol);
        } else {
          volume = g.modClamp(Math.floor(100 * (1 - i / (effectiveNumStutters - 1))), 25, 100);
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
  stutterPan(channels: number[], numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    numStutters = numStutters || g.ri(30, 90);
    duration = duration || g.tpSec * g.rf(0.1, 1.2);

    const CHsToStutter = g.ri(1, 2);
    const channelsToStutter = new Set<number>();
    const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));

    while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
      const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
      channelsToStutter.add(ch);
      availableCHs.splice(availableCHs.indexOf(ch), 1);
    }

    if (channelsToStutter.size < CHsToStutter) {
      this.lastUsedCHs2.clear();
    } else {
      this.lastUsedCHs2 = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach((channelToStutter: number) => {
      const edgeMargin = g.ri(7, 25);
      const effectiveNumStutters = numStutters ?? 4; // Default value
      const fullRange = 127 - edgeMargin;
      const centerZone = fullRange / 3;
      const leftBoundary = edgeMargin + centerZone;
      const rightBoundary = edgeMargin + 2 * centerZone;
      let currentPan = edgeMargin;
      let direction = 1;
      let tick: number = g.beatStart; // Initialize with default

      for (let i = Math.floor(effectiveNumStutters * g.rf(1 / 3, 2 / 3)); i < effectiveNumStutters; i++) {
        tick = g.beatStart + (i * (duration / effectiveNumStutters) * g.rf(0.9, 1.1));
        if (currentPan >= rightBoundary) {
          direction = -1;
        } else if (currentPan <= leftBoundary) {
          direction = 1;
        }
        currentPan += direction * (fullRange / effectiveNumStutters) * g.rf(0.5, 1.5);
        currentPan = g.modClamp(Math.floor(currentPan), edgeMargin, 127 - edgeMargin);
        g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, 10, currentPan] });
      }
      g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
    });
  }

  /**
   * Applies rapid FX parameter stutter effect to selected channels
   */
  stutterFX(channels: number[], numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    numStutters = numStutters || g.ri(30, 100);
    duration = duration || g.tpSec * g.rf(0.1, 2);

    const CHsToStutter = g.ri(1, 2);
    const channelsToStutter = new Set<number>();
    const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));

    while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
      const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
      channelsToStutter.add(ch);
      availableCHs.splice(availableCHs.indexOf(ch), 1);
    }

    if (channelsToStutter.size < CHsToStutter) {
      this.lastUsedCHs2.clear();
    } else {
      this.lastUsedCHs2 = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach((channelToStutter: number) => {
      const effectiveNumStutters = numStutters ?? 4; // Default value
      const startValue = g.ri(0, 127);
      const endValue = g.ri(0, 127);
      const ccParam = g.ra([91, 92, 93, 71, 74]);
      let tick: number = g.beatStart; // Initialize with default

      for (let i = Math.floor(effectiveNumStutters * g.rf(1 / 3, 2 / 3)); i < effectiveNumStutters; i++) {
        tick = g.beatStart + (i * (duration / effectiveNumStutters) * g.rf(0.9, 1.1));
        const progress = i / (effectiveNumStutters - 1);
        const currentValue = Math.floor(startValue + (endValue - startValue) * progress);
        g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, currentValue] });
      }
      g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, 64] });
    });
  }

  /**
   * Resets channel state tracking (clears lastUsedCHs and lastUsedCHs2)
   */
  resetChannelTracking(): void {
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();
  }
}
```

<!-- END: snippet:FxManager -->

#### `stutterFade(channels, numStutters?, duration?)`

Volume stutter/fade over selected channels with random ramps.

<!-- BEGIN: snippet:FxManager_stutterFade -->

```typescript
stutterFade(channels: number[], numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    numStutters = numStutters || g.ri(10, 70);
    duration = duration || g.tpSec * g.rf(0.2, 1.5);

    const CHsToStutter = g.ri(1, 5);
    const channelsToStutter = new Set<number>();
    const availableCHs = channels.filter(ch => !this.lastUsedCHs.has(ch));

    while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
      const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
      channelsToStutter.add(ch);
      availableCHs.splice(availableCHs.indexOf(ch), 1);
    }

    if (channelsToStutter.size < CHsToStutter) {
      this.lastUsedCHs.clear();
    } else {
      this.lastUsedCHs = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach((channelToStutter: number) => {
      const maxVol = g.ri(90, 120);
      const isFadeIn = g.rf() < 0.5;
      const effectiveNumStutters = numStutters ?? 4; // Default value
      let tick: number = g.beatStart; // Initialize with default
      let volume: number;

      for (let i = Math.floor(effectiveNumStutters * g.rf(1 / 3, 2 / 3)); i < effectiveNumStutters; i++) {
        tick = g.beatStart + (i * (duration / effectiveNumStutters) * g.rf(0.9, 1.1));
        if (isFadeIn) {
          volume = g.modClamp(Math.floor(maxVol * (i / (effectiveNumStutters - 1))), 25, maxVol);
        } else {
          volume = g.modClamp(Math.floor(100 * (1 - i / (effectiveNumStutters - 1))), 25, 100);
        }
        g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, 7, Math.round(volume / g.rf(1.5, 5))] });
        g.p(g.c, { tick: tick + duration * g.rf(0.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume] });
      }
      g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol] });
    });
  }
```

<!-- END: snippet:FxManager_stutterFade -->

#### `stutterPan(channels, numStutters?, duration?)`

Pan stutter with edge margins and center zones.

<!-- BEGIN: snippet:FxManager_stutterPan -->

```typescript
stutterPan(channels: number[], numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    numStutters = numStutters || g.ri(30, 90);
    duration = duration || g.tpSec * g.rf(0.1, 1.2);

    const CHsToStutter = g.ri(1, 2);
    const channelsToStutter = new Set<number>();
    const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));

    while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
      const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
      channelsToStutter.add(ch);
      availableCHs.splice(availableCHs.indexOf(ch), 1);
    }

    if (channelsToStutter.size < CHsToStutter) {
      this.lastUsedCHs2.clear();
    } else {
      this.lastUsedCHs2 = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach((channelToStutter: number) => {
      const edgeMargin = g.ri(7, 25);
      const effectiveNumStutters = numStutters ?? 4; // Default value
      const fullRange = 127 - edgeMargin;
      const centerZone = fullRange / 3;
      const leftBoundary = edgeMargin + centerZone;
      const rightBoundary = edgeMargin + 2 * centerZone;
      let currentPan = edgeMargin;
      let direction = 1;
      let tick: number = g.beatStart; // Initialize with default

      for (let i = Math.floor(effectiveNumStutters * g.rf(1 / 3, 2 / 3)); i < effectiveNumStutters; i++) {
        tick = g.beatStart + (i * (duration / effectiveNumStutters) * g.rf(0.9, 1.1));
        if (currentPan >= rightBoundary) {
          direction = -1;
        } else if (currentPan <= leftBoundary) {
          direction = 1;
        }
        currentPan += direction * (fullRange / effectiveNumStutters) * g.rf(0.5, 1.5);
        currentPan = g.modClamp(Math.floor(currentPan), edgeMargin, 127 - edgeMargin);
        g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, 10, currentPan] });
      }
      g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
    });
  }
```

<!-- END: snippet:FxManager_stutterPan -->

#### `stutterFX(channels, numStutters?, duration?)`

FX parameter stutter using CC targets (91/92/93/71/74).

<!-- BEGIN: snippet:FxManager_stutterFX -->

```typescript
stutterFX(channels: number[], numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    numStutters = numStutters || g.ri(30, 100);
    duration = duration || g.tpSec * g.rf(0.1, 2);

    const CHsToStutter = g.ri(1, 2);
    const channelsToStutter = new Set<number>();
    const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));

    while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
      const ch = availableCHs[Math.floor(Math.random() * availableCHs.length)];
      channelsToStutter.add(ch);
      availableCHs.splice(availableCHs.indexOf(ch), 1);
    }

    if (channelsToStutter.size < CHsToStutter) {
      this.lastUsedCHs2.clear();
    } else {
      this.lastUsedCHs2 = new Set(channelsToStutter);
    }

    const channelsArray = Array.from(channelsToStutter);
    channelsArray.forEach((channelToStutter: number) => {
      const effectiveNumStutters = numStutters ?? 4; // Default value
      const startValue = g.ri(0, 127);
      const endValue = g.ri(0, 127);
      const ccParam = g.ra([91, 92, 93, 71, 74]);
      let tick: number = g.beatStart; // Initialize with default

      for (let i = Math.floor(effectiveNumStutters * g.rf(1 / 3, 2 / 3)); i < effectiveNumStutters; i++) {
        tick = g.beatStart + (i * (duration / effectiveNumStutters) * g.rf(0.9, 1.1));
        const progress = i / (effectiveNumStutters - 1);
        const currentValue = Math.floor(startValue + (endValue - startValue) * progress);
        g.p(g.c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, currentValue] });
      }
      g.p(g.c, { tick: tick + duration * g.rf(0.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, 64] });
    });
  }
```

<!-- END: snippet:FxManager_stutterFX -->

#### `resetChannelTracking()`

Clear recent channel memory (tests/reshuffle).

<!-- BEGIN: snippet:FxManager_resetChannelTracking -->

```typescript
resetChannelTracking(): void {
    this.lastUsedCHs.clear();
    this.lastUsedCHs2.clear();
  }
```

<!-- END: snippet:FxManager_resetChannelTracking -->

### `fxManager`

Singleton instance exported for shared use.

---

## Usage Example

```typescript
import { fxManager } from '../src/fxManager';

fxManager.stutterFade([0,1,2]);
fxManager.stutterPan([3,4], 40, 200);
fxManager.stutterFX([5]);
```

---

## Related Modules

- rhythm.ts ([code](../src/rhythm.ts)) ([doc](rhythm.md)) - Uses stutters in drum patterns
- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - Emits MIDI events consumed by FX
- playNotes.ts ([code](../src/playNotes.ts)) ([doc](playNotes.md)) - Rendering layer for notes/CCs
