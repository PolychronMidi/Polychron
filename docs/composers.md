# composers.js - Musical Content Generation

> **Source**: `src/composers.js`
> **Status**: Core Module - Music Theory
> **Dependencies**: backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)), venue.js ([code](../src/venue.js)) ([doc](venue.md)), sheet.js ([code](../src/sheet.js)) ([doc](sheet.md))

## Overview

**composers.js** generates all musical content - notes, harmonies, time signatures, and voice counts. It provides a class hierarchy of composers that generate harmonically sophisticated music based on scales, chords, and modes.

**Core Responsibilities:**
- **Meter generation** - Creates complex time signatures with musical smoothing
- **Note selection** - Generates pitches from scales, chords, or modes
- **Subdivision control** - Determines rhythmic granularity (divisions/subdivisions)
- **Voice management** - Controls polyphonic density and octave ranges
- **Music theory validation** - Ensures generated content is musically coherent

## Architecture Role

**composers.js** operates in the **content generation layer**:
- **play.js** ([code](../src/play.js)) ([doc](play.md)) - Calls composer.getNotes() at each subdivision
- **time.js** ([code](../src/time.js)) ([doc](time.md)) - Uses getMeter(), getDivisions(), getSubdivisions()
- **stage.js** ([code](../src/stage.js)) ([doc](stage.md)) - Uses composer via play.js
- **venue.js** ([code](../src/venue.js)) ([doc](venue.md)) - Provides scale/chord/mode data via Tonal.js

---

## Base Class: `MeasureComposer`

### Purpose
Abstract base class defining the interface for all composer types. Handles meter generation, rhythmic parameters, and voice management.

### Core Methods

#### `getNumerator()` and `getDenominator()`
Generate numerator and denominator using weighted random selection from NUMERATOR/DENOMINATOR config:
```javascript
getNumerator() {
  const {min, max, weights} = NUMERATOR;
  return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
}
```
- **Weighted selection** - Uses probability weights for musical preference
- **BPM modulation** - 50% chance to scale by bpmRatio for tempo coherence

#### `getDivisions()`, `getSubdivisions()`, `getSubsubdivs()`, `getVoices()`
Similar patterns for hierarchical timing and voice count generation.

#### `getOctaveRange()`
Returns two octaves with 2-3 octave difference for voice spacing:
```javascript
getOctaveRange() {
  const {min, max, weights} = OCTAVE;
  let [o1, o2] = [rw(min, max, weights), rw(min, max, weights)];
  while (m.abs(o1 - o2) < ri(2, 3)) {
    o2 = modClamp(o2 + ri(-3, 3), min, max);
  }
  return [o1, o2];
}
```

#### `getMeter(ignoreRatioCheck, polyMeter, maxIterations)`

**Most sophisticated method** - generates time signatures with musical smoothness:

```javascript
getMeter(ignoreRatioCheck=false, polyMeter=false, maxIterations=100) {
  const METER_RATIO_MIN = 0.25;
  const METER_RATIO_MAX = 4;
  const FALLBACK_METER = [4, 4];
  const maxLogSteps = polyMeter ? 4 : 2;

  while (++iterations <= maxIterations) {
    let newNumerator = this.getNumerator();
    let newDenominator = this.getDenominator();

    if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) ||
        newNumerator <= 0 || newDenominator <= 0) {
      continue;
    }

    let newMeterRatio = newNumerator / newDenominator;
    const ratioValid = ignoreRatioCheck ||
      (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

    if (ratioValid) {
      if (this.lastMeter) {
        let lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
        // Log ratio: 0 = same, 1 = 2x, 2 = 4x, 3 = 8x, 4 = 16x
        let logSteps = m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
        if (logSteps >= 0.5 && logSteps <= maxLogSteps) {
          this.lastMeter = [newNumerator, newDenominator];
          return this.lastMeter;
        }
      } else {
        this.lastMeter = [newNumerator, newDenominator];
        return this.lastMeter;
      }
    }
  }

  console.warn(`getMeter() failed after ${iterations} iterations. Returning fallback [4, 4]`);
  this.lastMeter = FALLBACK_METER;
  return this.lastMeter;
}
```

**Algorithm:**
1. Generate random numerator and denominator
2. Validate integers in positive range
3. Check meter ratio is within bounds (0.25-4)
4. If first meter, return it
5. If subsequent meter, check log distance from previous (smooth transitions)
6. **Polyrhythm mode**: Allow larger log steps (16x ratio jumps)
7. **Fallback**: Return [4,4] after max iterations

**Why Logarithmic?** Logarithmic comparison ensures musically smooth meter changes. Log step = 1 means 2x ratio change (e.g., 4/4 to 2/4 or 3/4), step = 2 means 4x change. This prevents harsh meter transitions like 5/7 → 13/3.

#### `getNotes(octaveRange)`

Generates polyphonic note array using music theory:

```javascript
getNotes(octaveRange=null) {
  if (++this.recursionDepth > this.MAX_RECURSION) {
    console.warn('getNotes recursion limit exceeded');
    this.recursionDepth = 0;
    return [{note: 0}];
  }

  const uniqueNotes = new Set();
  const voices = this.getVoices();
  const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
  const rootNote = this.notes[ri(this.notes.length - 1)];
  let intervals = [];

  try {
    const shift = ri();
    switch (ri(2)) {
      case 0:
        intervals = [0, 2, 3+shift, 6-shift]
          .map(interval => clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1));
        break;
      case 1:
        intervals = [0, 1, 3+shift, 5+shift]
          .map(interval => clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1));
        break;
      default:
        intervals = Array.from({length: this.notes.length}, (_,i) => i);
    }

    return intervals.slice(0, voices).map((interval, index) => {
      const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
      let octave = ri(minOctave, maxOctave);
      let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;

      // Avoid duplicate pitches by shifting octaves
      while (uniqueNotes.has(note)) {
        octave = octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave;
        note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
      }
      uniqueNotes.add(note);
      return {note};
    }).filter((noteObj, index, self) =>
      index === self.findIndex(n => n.note === noteObj.note)
    );
  } catch (e) {
    console.warn(e.message);
    this.recursionDepth--;
    return this.getNotes(octaveRange);
  }
}
```

**Music Theory Strategy:**
- **Two interval patterns**: Generates either [0,2,3,6] or [0,1,3,5] scale degree intervals (chord voicings)
- **Fallback**: Uses chromatic if interval patterns fail
- **Octave distribution**: Spreads voices across specified octave range
- **Duplicate avoidance**: Shifts octaves to prevent pitch collisions
- **Recursion limit**: Prevents infinite loops with MAX_RECURSION = 5

---

## Composer Subclasses

### `ScaleComposer`
Generates notes from a specific scale (major, minor, harmonic minor, etc.):

```javascript
constructor(scaleName, root) {
  super();
  this.noteSet(scaleName, root);
}

noteSet(scaleName, root) {
  this.scale = t.Scale.get(`${root} ${scaleName}`);
  this.notes = this.scale.notes;
}

x = () => this.getNotes();
```

### `RandomScaleComposer`
Continuously generates from random scales and roots for maximum harmonic variety:

```javascript
noteSet() {
  const randomScale = allScales[ri(allScales.length - 1)];
  const randomRoot = allNotes[ri(allNotes.length - 1)];
  super.noteSet(randomScale, randomRoot);
}

x = () => {
  this.noteSet();
  return super.x();
}
```

### `ChordComposer`
Generates notes from a chord progression with direction control:

```javascript
constructor(progression) {
  super();
  this.noteSet(progression, 'R');
}

noteSet(progression, direction='R') {
  const validatedProgression = progression.filter(chordSymbol => {
    if (!allChords.includes(chordSymbol)) {
      console.warn(`Invalid chord: ${chordSymbol}`);
      return false;
    }
    return true;
  });
  // Navigate through progression based on direction
  this.progression = validatedProgression;
  this.currentChordIndex = 0;
}
```

**Direction Modes:**
- **'R'** - Right (forward through progression)
- **'L'** - Left (backward)
- **'E'** - Either (50/50 random)
- **'?'** - Random jump (-2 to +2 positions)

### `RandomChordComposer`
Generates new chord progressions on-the-fly:

```javascript
noteSet() {
  const progressionLength = ri(2, 5);
  const randomProgression = [];
  for (let i = 0; i < progressionLength; i++) {
    randomProgression.push(allChords[ri(allChords.length - 1)]);
  }
  super.noteSet(randomProgression, '?');
}
```

### `ModeComposer` and `RandomModeComposer`
Similar pattern using modal harmonic systems (church modes, jazz modes, etc.).

---

## Integration with Other Modules

**play.js** creates a composer instance:
```javascript
const composer = new RandomScaleComposer();  // or ScaleComposer, ChordComposer, etc.
```

**play.js** calls at each subdivision:
```javascript
setUnitTiming('subdivision');
const notes = composer.getNotes();  // Get 1-4 notes
playNotes();  // Send MIDI note-ons
```

**time.js** calls for timing:
```javascript
divsPerBeat = composer.getDivisions();
subdivsPerDiv = composer.getSubdivisions();
numerator = composer.getNumerator();  // When changing meters
```

---

## Error Handling

- **Graceful degradation** - Errors caught and methods retry with fallback patterns

## Voice Leading Integration

**As of Task 3.3**, all `MeasureComposer` subclasses support optional **voice leading optimization** for smooth melodic motion and professional voice management. See [voiceLeading.md](../voiceLeading.md) for complete documentation.

### Quick Start

Enable voice leading on any composer:
```javascript
const composer = new ScaleComposer('major', 'C');
composer.enableVoiceLeading();  // Uses default VoiceLeadingScore

// Select note using cost function
const selectedNote = composer.selectNoteWithLeading(candidateNotes, {
  register: 'soprano'
});
```

### Voice Leading Methods

- **`enableVoiceLeading(scorer?)`** - Activate voice leading (uses default if no scorer provided)
- **`selectNoteWithLeading(availableNotes, config?)`** - Select note using weighted cost function
- **`resetVoiceLeading()`** - Clear history at section boundaries

### Voice Leading Rules

Enforces these soft constraints via weighted penalties:
- **Smooth Motion** - Prefers stepwise motion (1-2 semitones) over leaps
- **Voice Range** - Enforces soprano/alto/tenor/bass register boundaries
- **Leap Recovery** - Leaps must be followed by stepwise motion in opposite direction
- **Voice Crossing** - Prevents soprano from crossing below alto
- **Parallel Motion** - Discourages repeated directional motion

### Integration with Composers

All subclasses inherit voice leading support:
- **ScaleComposer** - Smooth scale-based melodies with register control
- **ChordComposer** - Smooth voice leading through progressions
- **ModeComposer** - Modal melodies with voice leading constraints
- Plus all random variants (RandomScaleComposer, RandomChordComposer, RandomModeComposer)

### Backward Compatibility

- **Opt-in only** - Voice leading disabled by default
- **Non-breaking** - Existing code unaffected
- **Graceful fallback** - Returns random selection if voice leading disabled

For comprehensive documentation, see [voiceLeading.md](../voiceLeading.md).
