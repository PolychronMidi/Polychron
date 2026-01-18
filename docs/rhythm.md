# rhythm.ts - Rhythm & Drum Pattern Toolkit

> **Source**: `src/rhythm.ts`  
> **Status**: Core Rhythm Utility  
> **Dependencies**: Timing helpers (`tpSec`, `beatStart`), event bus, note utils, fxManager

## Overview

`rhythm.ts` builds drum/rhythm patterns, converts between durations and time, and drives MIDI CC accents. It provides binary/hex rhythm parsing, probabilistic and Euclidean generators, drummer playback utilities, and FX stutter helpers.

**Core Responsibilities:**
- Parse binary/hex/onset strings into rhythmic on/off sequences
- Generate rhythms via probability, randomness, Euclidean spacing, and morphing
- Play drum parts with velocity accents and swing (`playDrums`, `playDrums2`)
- Rotate/mutate patterns, add syncopation, and derive rests
- Coordinate stutter FX and pan/velocity envelopes

---

## API Highlights

Because this module exports many helpers, below lists the primary entry points developers touch most often.

- `rhythms` – prebuilt rhythm map used by composers
- `binaryRhythm(bits, length?)` – parse `'1010'`-style strings
- `hexRhythm(hex, length?)` – parse hex bitmasks
- `onsets(...indices)` / `onsetsStr('0 3 6')` – mark on-beat hits
- `probRhythm(len, chance)` / `randomRhythm(len)` – probabilistic generators
- `euclid(len, hits, rotate?)` – Euclidean spacing
- `rotate(pattern, n)` / `morph(pattern, fn)` – pattern transforms
- `drumNote(defaults)` – build drum-note factory with accents and swing
- `playDrums(part, options)` / `playDrums2(part, options)` – schedule drum events with velocity/pan/FX support
- `addStutterFx(events, channels)` – convenience to sprinkle stutters (delegates to `fxManager`)

Aux helpers: subdivision tools, duration conversion (`timeToBeat`, `secToBeat`), syncopation (`addSyncopation`), and gate manipulation (`restify`, `densify`).

---

## Usage Example

```typescript
import { rhythms, playDrums, euclid, rotate } from '../src/rhythm';

const pat = rotate(euclid(16, 5), 1);
const part = rhythms.kick(pat);
playDrums(part, { swing: 0.1, channel: 9 });
```

---

## Related Modules

- fxManager.ts ([code](../src/fxManager.ts)) ([doc](fxManager.md)) - Stutter FX applied during drum playback
- time.ts ([code](../src/time.ts)) ([doc](time.md)) - Beat/time conversions used by rhythm helpers
- playNotes.ts ([code](../src/playNotes.ts)) ([doc](playNotes.md)) - Emits MIDI notes built from rhythm patterns
