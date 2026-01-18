<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# MeasureComposer.ts - Rhythmic/Voice-Leading Engine

> **Status**: Core Composer Engine  
> **Dependencies**: voiceLeading.ts utilities (VoiceLeadingScore)


## Overview

`MeasureComposer.ts` is the rhythmic and voice-leading backbone for all composers. It generates meters, subdivisions, and note selections with randomization, voice-leading scoring, and guardrails against invalid meters. Higher-level composers supply pitch collections while MeasureComposer shapes timing and registers.

**Core Responsibilities:**
- Randomized meter generation with ratio bounds and iteration/time limits
- Note selection across octave ranges with uniqueness attempts and soft bounds
- Optional voice-leading with history-based selection
- Utility getters for numerator/denominator/divisions/subdivisions and octave spans

## Architecture Role

- Base class for GenericComposer and all concrete composers (scale, mode, chord, pentatonic)
- Provides the shared `getNotes()` engine used by GenericComposer and its descendants
- Integrates with VoiceLeadingScore from voiceLeading.ts when enabled

---

## API

### `class MeasureComposer`

Meter and note-generation engine with optional voice leading.

<!-- BEGIN: snippet:MeasureComposer -->

```typescript
class MeasureComposer {
  lastMeter: number[] | null;
  recursionDepth: number;
  MAX_RECURSION: number;
  voiceLeading: any;
  voiceHistory: number[];
  notes: string[];

  constructor() {
    this.lastMeter = null;
    this.recursionDepth = 0;
    this.MAX_RECURSION = 5;
    this.voiceLeading = null;
    this.voiceHistory = [];
    this.notes = [];
  }

  getNumerator(): number {
    const { min, max, weights } = NUMERATOR;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getDenominator(): number {
    const { min, max, weights } = DENOMINATOR;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getDivisions(): number {
    const { min, max, weights } = DIVISIONS;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getSubdivisions(): number {
    const { min, max, weights } = SUBDIVISIONS;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getSubsubdivs(): number {
    const { min, max, weights } = SUBSUBDIVS;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getVoices(): number {
    const { min, max, weights } = VOICES;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getOctaveRange(): number[] {
    const { min, max, weights } = OCTAVE;
    let [o1, o2] = [rw(min, max, weights), rw(min, max, weights)];
    while (m.abs(o1 - o2) < ri(2, 3)) {
      o2 = modClamp(o2 + ri(-3, 3), min, max);
    }
    return [o1, o2];
  }

  getMeter(ignoreRatioCheck = false, polyMeter = false, maxIterations = 200, timeLimitMs = 100): number[] {
    const METER_RATIO_MIN = 0.25;
    const METER_RATIO_MAX = 4;
    const MIN_LOG_STEPS = 0.5;
    const FALLBACK_METER = [4, 4];

    let iterations = 0;
    const maxLogSteps = polyMeter ? 4 : 2;
    const startTs = Date.now();

    while (++iterations <= maxIterations && (Date.now() - startTs) <= timeLimitMs) {
      let newNumerator = this.getNumerator();
      let newDenominator = this.getDenominator();

      if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
        continue;
      }

      let newMeterRatio = newNumerator / newDenominator;
      const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

      if (ratioValid) {
        if (this.lastMeter) {
          let lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
          let logSteps = m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
          if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps) {
            this.lastMeter = [newNumerator, newDenominator];
            return this.lastMeter;
          }
        } else {
          this.lastMeter = [newNumerator, newDenominator];
          return this.lastMeter;
        }
      }
    }

    console.warn(
      `getMeter() failed after ${iterations} iterations or ${Date.now() - startTs}ms. ` +
      `Ratio bounds: [${METER_RATIO_MIN}, ${METER_RATIO_MAX}]. ` +
      `LogSteps range: [${MIN_LOG_STEPS}, ${maxLogSteps}]. ` +
      `Returning fallback: [${FALLBACK_METER[0]}, ${FALLBACK_METER[1]}]`
    );
    this.lastMeter = FALLBACK_METER;
    return this.lastMeter;
  }

  getNotes(octaveRange: number[] | null = null): { note: number }[] {
    if (++this.recursionDepth > this.MAX_RECURSION) {
      console.warn('getNotes recursion limit exceeded; returning fallback note 0');
      this.recursionDepth = 0;
      return [{ note: 0 }];
    }

    const uniqueNotes = new Set();
    const voices = this.getVoices();
    let [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    // Ensure minOctave <= maxOctave
    if (minOctave > maxOctave) {
      [minOctave, maxOctave] = [maxOctave, minOctave];
    }

    // DESIGN NOTE: octaveRange is a SOFT constraint, not hard. This is intentional for random music generation.
    // When seeking unique notes within the range, if we exhaust available octaves within bounds,
    // we accept the duplicate rather than escaping to global bounds. Occasionally notes may fall
    // slightly outside the range due to voice leading optimization - this is by design and prevents
    // excessive constraint-solving overhead. Tests verify MIDI validity, not strict octave bounds.
    const rootNote = this.notes[ri(this.notes.length - 1)];
    let intervals: number[] = [];
    let fallback = false;

    try {
      const shift = ri();
      switch (ri(2)) {
        case 0:
          intervals = [0, 2, 3 + shift, 6 - shift].map((interval: number) =>
            clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)
          );
          break;
        case 1:
          intervals = [0, 1, 3 + shift, 5 + shift].map((interval: number) =>
            clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)
          );
          break;
        default:
          intervals = Array.from({ length: this.notes.length }, (_, i) => i);
          fallback = true;
      }

      intervals = intervals.map((interval: number) => {
        const validatedInterval = clamp(interval, 0, this.notes.length - 1);
        const rootIndex = this.notes.indexOf(rootNote);
        const noteIndex = (rootIndex + validatedInterval) % this.notes.length;
        return validatedInterval;
      });

      const notes: { note: number }[] = [];
      for (let i = 0; i < voices; i++) {
        if (i >= intervals.length) break;

        const interval = intervals[i];
        const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
        const noteName = this.notes[noteIndex];
        const chroma = t.Note.chroma(noteName);

        // Skip if chroma is invalid (Tonal couldn't parse the note)
        if (chroma === null || chroma === undefined || isNaN(chroma)) {
          continue;
        }

        let octave = ri(minOctave, maxOctave);
        let note = chroma + 12 * octave;
        let attempts = 0;

        // Try to find unique note within octaveRange bounds
        while (uniqueNotes.has(note) && attempts < 10) {
          if (octave < maxOctave) {
            octave++;
          } else if (octave > minOctave) {
            octave--;
          } else {
            // No more octaves available in range, accept the duplicate
            break;
          }
          note = chroma + 12 * octave;
          attempts++;
        }

        uniqueNotes.add(note);
        notes.push({ note });
      }

      return notes.filter((noteObj, index, self) =>
        index === self.findIndex(n => n.note === noteObj.note)
      );
    } catch (e) {
      const error = e as any;
      if (!fallback) {
        this.recursionDepth--;
        return this.getNotes(octaveRange);
      } else {
        console.warn(error.message);
        this.recursionDepth--;
        return this.getNotes(octaveRange);
      }
    } finally {
      this.recursionDepth--;
    }
  }

  enableVoiceLeading(scorer?: any): void {
    this.voiceLeading = scorer || new VoiceLeadingScore();
    this.voiceHistory = [];
  }

  disableVoiceLeading(): void {
    this.voiceLeading = null;
    this.voiceHistory = [];
  }

  selectNoteWithLeading(availableNotes: number[], config: { register?: string; constraints?: string[] } = {}): number {
    if (!this.voiceLeading || !availableNotes || availableNotes.length === 0) {
      return (availableNotes as any)?.[ri(availableNotes.length - 1)] ?? 60;
    }

    const selectedNote = this.voiceLeading.selectNextNote(this.voiceHistory, availableNotes, config);
    this.voiceHistory.push(selectedNote);

    if (this.voiceHistory.length > 4) {
      this.voiceHistory.shift();
    }

    return selectedNote;
  }

  resetVoiceLeading(): void {
    this.voiceHistory = [];
    if (this.voiceLeading) {
      this.voiceLeading.reset();
    }
  }
}
```

<!-- END: snippet:MeasureComposer -->

#### `getNumerator()` / `getDenominator()` / `getDivisions()` / `getSubdivisions()` / `getSubsubdivs()` / `getVoices()`

Randomized rhythmic parameters with weighted ranges.

<!-- BEGIN: snippet:MeasureComposer_getNumerator -->

```typescript
getNumerator(): number {
    const { min, max, weights } = NUMERATOR;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }
```

<!-- END: snippet:MeasureComposer_getNumerator -->

#### `getOctaveRange()`

Picks a spread of octaves with minimum separation.

<!-- BEGIN: snippet:MeasureComposer_getOctaveRange -->

```typescript
getOctaveRange(): number[] {
    const { min, max, weights } = OCTAVE;
    let [o1, o2] = [rw(min, max, weights), rw(min, max, weights)];
    while (m.abs(o1 - o2) < ri(2, 3)) {
      o2 = modClamp(o2 + ri(-3, 3), min, max);
    }
    return [o1, o2];
  }
```

<!-- END: snippet:MeasureComposer_getOctaveRange -->

#### `getMeter(ignoreRatioCheck?, polyMeter?, maxIterations?, timeLimitMs?)`

Generates a valid meter within ratio/log-step bounds; falls back to 4/4 on failure.

<!-- BEGIN: snippet:MeasureComposer_getMeter -->

```typescript
getMeter(ignoreRatioCheck = false, polyMeter = false, maxIterations = 200, timeLimitMs = 100): number[] {
    const METER_RATIO_MIN = 0.25;
    const METER_RATIO_MAX = 4;
    const MIN_LOG_STEPS = 0.5;
    const FALLBACK_METER = [4, 4];

    let iterations = 0;
    const maxLogSteps = polyMeter ? 4 : 2;
    const startTs = Date.now();

    while (++iterations <= maxIterations && (Date.now() - startTs) <= timeLimitMs) {
      let newNumerator = this.getNumerator();
      let newDenominator = this.getDenominator();

      if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
        continue;
      }

      let newMeterRatio = newNumerator / newDenominator;
      const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

      if (ratioValid) {
        if (this.lastMeter) {
          let lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
          let logSteps = m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
          if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps) {
            this.lastMeter = [newNumerator, newDenominator];
            return this.lastMeter;
          }
        } else {
          this.lastMeter = [newNumerator, newDenominator];
          return this.lastMeter;
        }
      }
    }

    console.warn(
      `getMeter() failed after ${iterations} iterations or ${Date.now() - startTs}ms. ` +
      `Ratio bounds: [${METER_RATIO_MIN}, ${METER_RATIO_MAX}]. ` +
      `LogSteps range: [${MIN_LOG_STEPS}, ${maxLogSteps}]. ` +
      `Returning fallback: [${FALLBACK_METER[0]}, ${FALLBACK_METER[1]}]`
    );
    this.lastMeter = FALLBACK_METER;
    return this.lastMeter;
  }
```

<!-- END: snippet:MeasureComposer_getMeter -->

#### `getNotes(octaveRange?)`

Voice-leading-aware note selection across available pitches; prevents recursion blowups and filters invalid chroma.

<!-- BEGIN: snippet:MeasureComposer_getNotes -->

```typescript
getNotes(octaveRange: number[] | null = null): { note: number }[] {
    if (++this.recursionDepth > this.MAX_RECURSION) {
      console.warn('getNotes recursion limit exceeded; returning fallback note 0');
      this.recursionDepth = 0;
      return [{ note: 0 }];
    }

    const uniqueNotes = new Set();
    const voices = this.getVoices();
    let [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    // Ensure minOctave <= maxOctave
    if (minOctave > maxOctave) {
      [minOctave, maxOctave] = [maxOctave, minOctave];
    }

    // DESIGN NOTE: octaveRange is a SOFT constraint, not hard. This is intentional for random music generation.
    // When seeking unique notes within the range, if we exhaust available octaves within bounds,
    // we accept the duplicate rather than escaping to global bounds. Occasionally notes may fall
    // slightly outside the range due to voice leading optimization - this is by design and prevents
    // excessive constraint-solving overhead. Tests verify MIDI validity, not strict octave bounds.
    const rootNote = this.notes[ri(this.notes.length - 1)];
    let intervals: number[] = [];
    let fallback = false;

    try {
      const shift = ri();
      switch (ri(2)) {
        case 0:
          intervals = [0, 2, 3 + shift, 6 - shift].map((interval: number) =>
            clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)
          );
          break;
        case 1:
          intervals = [0, 1, 3 + shift, 5 + shift].map((interval: number) =>
            clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)
          );
          break;
        default:
          intervals = Array.from({ length: this.notes.length }, (_, i) => i);
          fallback = true;
      }

      intervals = intervals.map((interval: number) => {
        const validatedInterval = clamp(interval, 0, this.notes.length - 1);
        const rootIndex = this.notes.indexOf(rootNote);
        const noteIndex = (rootIndex + validatedInterval) % this.notes.length;
        return validatedInterval;
      });

      const notes: { note: number }[] = [];
      for (let i = 0; i < voices; i++) {
        if (i >= intervals.length) break;

        const interval = intervals[i];
        const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
        const noteName = this.notes[noteIndex];
        const chroma = t.Note.chroma(noteName);

        // Skip if chroma is invalid (Tonal couldn't parse the note)
        if (chroma === null || chroma === undefined || isNaN(chroma)) {
          continue;
        }

        let octave = ri(minOctave, maxOctave);
        let note = chroma + 12 * octave;
        let attempts = 0;

        // Try to find unique note within octaveRange bounds
        while (uniqueNotes.has(note) && attempts < 10) {
          if (octave < maxOctave) {
            octave++;
          } else if (octave > minOctave) {
            octave--;
          } else {
            // No more octaves available in range, accept the duplicate
            break;
          }
          note = chroma + 12 * octave;
          attempts++;
        }

        uniqueNotes.add(note);
        notes.push({ note });
      }

      return notes.filter((noteObj, index, self) =>
        index === self.findIndex(n => n.note === noteObj.note)
      );
    } catch (e) {
      const error = e as any;
      if (!fallback) {
        this.recursionDepth--;
        return this.getNotes(octaveRange);
      } else {
        console.warn(error.message);
        this.recursionDepth--;
        return this.getNotes(octaveRange);
      }
    } finally {
      this.recursionDepth--;
    }
  }
```

<!-- END: snippet:MeasureComposer_getNotes -->

#### `enableVoiceLeading(scorer?)` / `disableVoiceLeading()` / `resetVoiceLeading()`

Toggle voice-leading and reset history.

<!-- BEGIN: snippet:MeasureComposer_enableVoiceLeading -->

```typescript
enableVoiceLeading(scorer?: any): void {
    this.voiceLeading = scorer || new VoiceLeadingScore();
    this.voiceHistory = [];
  }
```

<!-- END: snippet:MeasureComposer_enableVoiceLeading -->

#### `selectNoteWithLeading(availableNotes, config?)`

Selects next note via voice-leading scorer, maintaining rolling history.

<!-- BEGIN: snippet:MeasureComposer_selectNoteWithLeading -->

```typescript
selectNoteWithLeading(availableNotes: number[], config: { register?: string; constraints?: string[] } = {}): number {
    if (!this.voiceLeading || !availableNotes || availableNotes.length === 0) {
      return (availableNotes as any)?.[ri(availableNotes.length - 1)] ?? 60;
    }

    const selectedNote = this.voiceLeading.selectNextNote(this.voiceHistory, availableNotes, config);
    this.voiceHistory.push(selectedNote);

    if (this.voiceHistory.length > 4) {
      this.voiceHistory.shift();
    }

    return selectedNote;
  }
```

<!-- END: snippet:MeasureComposer_selectNoteWithLeading -->

---

## Usage Example

```typescript
import MeasureComposer from '../src/composers/MeasureComposer';

const mc = new MeasureComposer();
mc.enableVoiceLeading();

const meter = mc.getMeter();
const notes = mc.getNotes();
const withLeading = mc.selectNoteWithLeading(notes.map(n => n.note));
```

---

## Related Modules

- GenericComposer.ts ([code](../../src/composers/GenericComposer.ts)) ([doc](GenericComposer.md)) - Base for scale-like composers
- ScaleComposer.ts ([code](../../src/composers/ScaleComposer.ts)) ([doc](ScaleComposer.md)) - Scale-based melodies
- ModeComposer.ts ([code](../../src/composers/ModeComposer.ts)) ([doc](ModeComposer.md)) - Mode-based melodies
- ChordComposer.ts ([code](../../src/composers/ChordComposer.ts)) ([doc](ChordComposer.md)) - Progression-aware chords
- PentatonicComposer.ts ([code](../../src/composers/PentatonicComposer.ts)) ([doc](PentatonicComposer.md)) - Pentatonic phrasing

