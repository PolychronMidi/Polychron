<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# voiceLeading.ts - Voice Leading Utilities

> **Status**: Polyphonic Composition Utility  
> **Dependencies**: Music theory helpers, MIDI utilities


## Overview

`voiceLeading.ts` provides utilities for maintaining smooth voice leading across chord changes and harmonic progressions. It coordinates smooth pitch transitions, handles voice doubling, avoids parallel fifths/octaves, and ensures smooth voice independence across staves/channels.

**Core Responsibilities:**
- Implement smoothness metrics between chords
- Provide voice assignment strategies to minimize jumps
- Handle voice crossings and inversions
- Support doubling strategies (root doubling, soprano doubling)
- Manage voice independence constraints

---

## API Highlights

This module exports voice leading analysis and optimization functions used primarily by MeasureComposer:

- `VoiceLeadingScore` class – Analyzes chord transitions for smoothness
- Metrics for parallel motion, voice crossing, doubling
- Assignment algorithms for optimal voice paths

---

## Usage Example

```typescript
import { VoiceLeadingScore } from '../src/voiceLeading';

// Analyze transition between two chords
const score = new VoiceLeadingScore(
  [60, 64, 67],  // C major
  [62, 65, 69]   // D minor
);

// Score contains smoothness metrics
console.log(score.totalSmoothness());
```

---

## Subdirectory

- voiceLeading/ ([code](../src/voiceLeading/)) ([doc](voiceLeading/index.md)) - Individual voice leading implementations
  - VoiceLeadingScore.ts ([code](../src/voiceLeading/VoiceLeadingScore.ts)) ([doc](voiceLeading/VoiceLeadingScore.md)) - Chord transition scoring

---

## Related Modules

- composers/MeasureComposer.ts ([code](../src/composers/MeasureComposer.ts)) ([doc](composers/MeasureComposer.md)) - Primary voice leading consumer
- venue.ts ([code](../src/venue.ts)) ([doc](venue.md)) - Provides chord templates
