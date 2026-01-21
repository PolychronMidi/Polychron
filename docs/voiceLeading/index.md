# voiceLeading/ – Voice Leading Module Index

> **Subdirectory**: `src/voiceLeading/`
> **Status**: Polyphonic Composition Utilities
> **Dependencies**: Music theory, chord/voice data


## Overview

The `voiceLeading/` subdirectory provides voice leading analysis and optimization for smooth harmonic progressions. It implements classical voice leading rules to ensure smooth chord changes, maintain voice independence, and avoid parallel fifths/octaves.

---

## Modules

### VoiceLeadingScore.ts

Chord change scoring and voice optimization.

- **File**: [VoiceLeadingScore.ts](../src/voiceLeading/VoiceLeadingScore.ts)
- **Doc**: [VoiceLeadingScore.md](VoiceLeadingScore.md)
- **Purpose**: Evaluate and optimize chord changes
- **Key API**: `calculateCost()`, `findBestVoicing()`, `selectNextNote()`, `analyzeQuality()`

---

## Architecture

```
VoiceLeadingScore (scorer instance)
  └─ Evaluation metrics
     ├─ Smooth motion (stepwise preferred)
     ├─ Voice range constraints
     ├─ Leap recovery rules
     ├─ Voice crossing detection
     └─ Parallel motion avoidance
```

---

## Usage Pattern

```typescript
import { VoiceLeadingScore } from '../src/voiceLeading/VoiceLeadingScore';

const scorer = new VoiceLeadingScore();

// During chord selection
const previousChord = [60, 64, 67];      // C major
const targetChord = [62, 65, 69];        // D minor

// Find smoothest change
const bestVoicing = scorer.findBestVoicing(targetChord, previousChord);

// Select individual notes
const nextNote = scorer.selectNextNote(
  [67],                    // Previous soprano note
  [62, 65, 69],           // Chord options
  { register: 'soprano' }
);
```

---

## Voice Leading Rules Implemented

1. **Smooth Motion** – Prefer stepwise (1-2 semitones) over leaps
2. **Voice Range** – Keep notes within register (soprano/alto/tenor/bass)
3. **Leap Recovery** – After a leap, return by step in opposite direction
4. **Voice Crossing** – Soprano should remain above other voices
5. **Parallel Fifths/Octaves** – Avoid parallel motion by perfect intervals
6. **Same-Direction Motion** – Penalize (not forbidden) same-direction parallel motion

---

## Cost Weighting

Voice leading rules have configurable weights (default values shown):

- `smoothMotionWeight: 1.0` – Motion smoothness (lower cost)
- `voiceRangeWeight: 0.8` – Range constraints
- `leapRecoveryWeight: 0.6` – Leap recovery rules
- `voiceCrossingWeight: 2.0` – Voice crossing (heavily penalized)
- `parallelMotionWeight: 1.5` – Parallel motion detection

---

## Related Modules

- voiceLeading.ts ([code](../src/voiceLeading.ts)) ([doc](../voiceLeading.md)) - Root module wrapper
- composers/MeasureComposer.ts ([code](../src/composers/MeasureComposer.ts)) ([doc](../composers/MeasureComposer.md)) - Uses voice leading for smooth chord composition
- venue.ts ([code](../src/venue.ts)) ([doc](../venue.md)) - Chord/scale definitions
