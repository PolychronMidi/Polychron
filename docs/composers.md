# **composers.js** ([code](../src/composers.js)) ([doc](composers.md)) - Musical Content Generation

> **Source**: `src/composers.js`
> **Status**: Core Module - Music Theory
> **Dependencies**: **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md)) ([code](../src/backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)))) ([doc](backstage.md)), **venue.js** ([code](../src/venue.js)) ([doc](venue.md)) ([code](../src/venue.js ([code](../src/venue.js)) ([doc](venue.md)))) ([doc](venue.md)), **sheet.js** ([code](../src/sheet.js)) ([doc](sheet.md)) ([code](../src/sheet.js ([code](../src/sheet.js)) ([doc](sheet.md)))) ([doc](sheet.md))

## Overview

**composers.js** ([code](../src/composers.js)) ([doc](composers.md))** ([code](../src/composers.js ([code](../src/composers.js)) ([doc](composers.md)))) ([doc](composers.md)) generates all musical content - notes, harmonies, time signatures, and voice counts. It provides a class hierarchy of composers that generate harmonically sophisticated music based on scales, chords, and modes.

**Core Responsibilities:**
- **Meter generation** - Creates complex time signatures with musical smoothing
- **Note selection** - Generates pitches from scales, chords, modes, and progressions
- **Subdivision control** - Determines rhythmic granularity (divisions/subdivisions)
- **Voice management** - Controls polyphonic density and octave ranges
- **Music theory validation** - Ensures generated content is musically coherent with enharmonic normalization
- **Harmonic progression** - Advanced chord progressions with tension/release curves and modal interchange

## Architecture Role

**composers.js** ([code](../src/composers.js)) ([doc](composers.md))** ([code](../src/composers.js ([code](../src/composers.js)) ([doc](composers.md)))) ([doc](composers.md)) operates in the **content generation layer**:
- **play.js** ([code](../src/play.js)) ([doc](play.md))** ([code](../src/play.js ([code](../src/play.js)) ([doc](play.md)))) ([doc](play.md)) - Calls composer.getNotes() at each subdivision
- **time.js** ([code](../src/time.js)) ([doc](time.md))** ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)) - Uses getMeter(), getDivisions(), getSubdivisions()
- **stage.js** ([code](../src/stage.js)) ([doc](stage.md))** ([code](../src/stage.js ([code](../src/stage.js)) ([doc](stage.md)))) ([doc](stage.md)) - Uses composer via **play.js** ([code](../src/play.js)) ([doc](play.md))
- **venue.js** ([code](../src/venue.js)) ([doc](venue.md))** ([code](../src/venue.js ([code](../src/venue.js)) ([doc](venue.md)))) ([doc](venue.md)) - Provides scale/chord/mode data via Tonal.js

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

### Phase 1: Basic Composers

#### `ScaleComposer`
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

#### `ChordComposer`
Generates notes from a chord progression with direction control and enharmonic normalization:

```javascript
constructor(progression) {
  super();
  this.noteSet(progression, 'R');
}

noteSet(progression, direction='R') {
  // Normalizes enharmonic symbols (B#m7 → Cm7, Gb#m7 → Gm7)
  const validatedProgression = progression.map(normalizeChordSymbol).filter(chordSymbol => {
    const chord = t.Chord.get(chordSymbol);
    if (chord.empty) {
      console.warn(`Invalid chord symbol: ${chordSymbol}`);
      return false;
    }
    return true;
  });
  this.progression = validatedProgression.map(t.Chord.get);
  this.currentChordIndex = 0;
}
```

**Direction Modes:**
- **'R'** - Right (forward through progression)
- **'L'** - Left (backward)
- **'E'** - Either (50/50 random)
- **'?'** - Random jump (-2 to +2 positions)

**Enharmonic Normalization:**
Chords are automatically normalized to simplest enharmonic spelling:
- `B#` → `C`, `E#` → `F`, `Cb` → `B`, `Fb` → `E`
- `Bb#` → `B`, `Eb#` → `E`, `Gb#` → `G` (double accidentals)
- `C#` → `Db`, `F#` → `Gb`, `G#` → `Ab`, `A#` → `Bb`

#### `ModeComposer`
Generates notes from modal systems (church modes, jazz modes, etc.):

```javascript
constructor(modeName, root) {
  super();
  this.noteSet(modeName, root);
}

noteSet(modeName, root) {
  this.mode = t.Mode.get(`${root} ${modeName}`);
  this.notes = this.mode.notes;
}
```

### Phase 2: Advanced Composers

#### `PentatonicComposer`
Generates notes from pentatonic scales with open voicing preferences:

```javascript
constructor(root = 'C', type = 'major') {
  super();
  this.root = root;
  this.type = type;  // 'major' or 'minor'
  this.noteSet(root, type);
}

noteSet(root, type) {
  const scaleName = type === 'minor' ? 'minor pentatonic' : 'major pentatonic';
  const scale = t.Scale.get(`${root} ${scaleName}`);
  
  if (scale.empty) {
    console.warn(`Pentatonic scale not found for ${root} ${type}, using random root`);
    this.root = allNotes[ri(allNotes.length - 1)];
    const fallbackScaleName = this.type === 'minor' ? 'minor pentatonic' : 'major pentatonic';
    const fallbackScale = t.Scale.get(`${this.root} ${fallbackScaleName}`);
    this.notes = fallbackScale.notes;
  } else {
    this.notes = scale.notes;
  }
}

getNotes(octaveRange) {
  // Emphasizes 4ths and 5ths for open voicing
  // Prefers wider intervals (>2 semitones) between voices
  return super.getNotes(octaveRange);
}
```

**Musical Characteristics:**
- Avoids semitone intervals for consonant harmonies
- Emphasizes perfect 4ths and 5ths in voicing
- Ideal for ambient, world music, and modal jazz styles

#### `ProgressionGenerator`
Utility class for generating common harmonic progressions using Tonal's Key helpers:

```javascript
constructor(key = 'C', quality = 'major') {
  this.key = key;
  this.quality = quality;
  this.scale = quality === 'major' 
    ? t.Key.majorKey(key) 
    : t.Key.minorKey(key);
}

generate(type) {
  switch(type) {
    case 'I-IV-V': return this.romanToChord(['I', 'IV', 'V']);
    case 'ii-V-I': return this.romanToChord(['ii', 'V', 'I']);
    case 'I-vi-IV-V': return this.romanToChord(['I', 'vi', 'IV', 'V']);
    case 'circle': return this.circleOfFifths();
    default:
      console.warn(`Unknown progression type: ${type}, using I-IV-V`);
      return this.romanToChord(['I', 'IV', 'V']);
  }
}

romanToChord(romanNumerals) {
  // Derives chord qualities from Tonal's diatonic data
  return romanNumerals.map(roman => {
    const degree = this.parseDegree(roman);
    const diatonicChord = this.scale.chords[degree];
    const quality = this.deriveQuality(roman, diatonicChord);
    return `${this.scale.notes[degree]}${quality}`;
  });
}
```

**Supported Progressions:**
- **I-IV-V** - Classic cadence (rock, pop, blues)
- **ii-V-I** - Jazz standard turnaround
- **I-vi-IV-V** - "Doo-wop" progression (50s/60s pop)
- **circle** - Circle of fifths (all 12 keys)

#### `TensionReleaseComposer`
Generates progressions following a harmonic tension curve:

```javascript
constructor(key = 'C', quality = 'major', tensionCurve = 0.5) {
  const generator = new ProgressionGenerator(key, quality);
  const progressionChords = generator.random();
  super(progressionChords);
  
  this.generator = generator;
  this.tensionCurve = clamp(tensionCurve, 0, 1);
  this.key = key;
  this.quality = quality;
  this.measureInSection = 0;
}

calculateTension(chordSymbol) {
  const chord = t.Chord.get(chordSymbol);
  const root = chord.tonic;
  const scaleIndex = this.generator.scale.notes.indexOf(root);
  
  // Tonic function (I, vi) = low tension
  if ([0, 5].includes(scaleIndex)) return 0.2;
  // Subdominant (ii, IV) = medium tension
  if ([1, 3].includes(scaleIndex)) return 0.5;
  // Dominant (V, vii) = high tension
  if ([4, 6].includes(scaleIndex)) return 0.9;
  
  return 0.5;
}

selectChordByTension(position) {
  const targetTension = this.tensionCurve * Math.sin(position * Math.PI);
  
  // At end of phrase, resolve to tonic
  if (position > 0.85) {
    return this.generator.generate('I-IV-V').slice(-1);
  }
  
  // Select chord matching target tension from pool
  const allProgressions = [
    ...this.generator.generate('I-IV-V'),
    ...this.generator.generate('ii-V-I'),
    ...this.generator.generate('I-vi-IV-V')
  ];
  
  // Find chord with tension closest to target
  let bestChord = allProgressions[0];
  let bestDiff = Infinity;
  
  for (const chord of allProgressions) {
    const tension = this.calculateTension(chord);
    const diff = Math.abs(tension - targetTension);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestChord = chord;
    }
  }
  
  return [bestChord];
}
```

**Musical Characteristics:**
- **tensionCurve = 0**: Mostly tonic/stable chords
- **tensionCurve = 0.5**: Balanced tension/release
- **tensionCurve = 1**: Maximum harmonic tension with resolutions
- **16-measure cycle**: Tension arc follows sine wave over 16 measures

#### `ModalInterchangeComposer`
Borrows chords from parallel modes for harmonic color:

```javascript
constructor(key = 'C', primaryMode = 'major', borrowProbability = 0.25) {
  const generator = new ProgressionGenerator(key, primaryMode);
  const progressionChords = generator.random();
  super(progressionChords);
  
  this.generator = generator;
  this.key = key;
  this.primaryMode = primaryMode;
  this.borrowProbability = clamp(borrowProbability, 0, 1);
  
  // Parallel mode for borrowing
  this.parallelMode = primaryMode === 'major' ? 'minor' : 'major';
  this.parallelGenerator = new ProgressionGenerator(key, this.parallelMode);
}

borrowChord() {
  if (rf() < this.borrowProbability) {
    // Borrow from parallel mode
    const borrowedProgression = this.parallelGenerator.random();
    return borrowedProgression[ri(borrowedProgression.length - 1)];
  }
  // Use primary mode chord
  const primaryProgression = this.generator.random();
  return primaryProgression[ri(primaryProgression.length - 1)];
}

noteSet(progression, direction = 'modal') {
  if (direction === 'modal') {
    const chord = this.borrowChord();
    super.noteSet([chord], 'R');
  } else {
    super.noteSet(progression, direction);
  }
}
```

**Musical Examples:**
- **C major borrowing from C minor**: Cm, Fm, Ab, Bb chords in C major context
- **A minor borrowing from A major**: A, D, E major chords in A minor context
- **borrowProbability = 0.25**: 25% borrowed chords, 75% diatonic

**Use Cases:**
- Film scores (emotional ambiguity)
- Progressive rock/metal (tonal color shifts)
- Jazz harmony (chromatic voice leading)

---

## ComposerFactory and Configuration

### Unified Configuration System

All composers use a **unified parametric configuration** where `'random'` can be passed as parameter values. This eliminates the need for separate `randomScale`, `randomChords`, etc. composer types.

### Factory Pattern

```javascript
class ComposerFactory {
  static constructors = {
    measure: () => new MeasureComposer(),
    
    scale: ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ScaleComposer(n, r);
    },
    
    chords: ({ progression = ['C'] } = {}) => {
      let p = progression;
      if (progression === 'random') {
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) {
          p.push(allChords[ri(allChords.length - 1)]);
        }
      }
      return new ChordComposer(p);
    },
    
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? allModes[ri(allModes.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ModeComposer(n, r);
    },
    
    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new PentatonicComposer(r, t);
    },
    
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) => 
      new TensionReleaseComposer(key, quality, tensionCurve),
    
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => 
      new ModalInterchangeComposer(key, primaryMode, borrowProbability),
  };
  
  static create(config = {}) {
    const type = config.type || 'scale';
    const factory = this.constructors[type];
    if (!factory) {
      console.warn(`Unknown composer type: ${type}. Falling back to random scale.`);
      return this.constructors.scale({ name: 'random', root: 'random' });
    }
    return factory(config);
  }
}
```

### Configuration Examples

**sheet.js COMPOSERS array:**

```javascript
COMPOSERS = [
  // Specific composers
  { type: 'scale', name: 'major', root: 'C' },
  { type: 'chords', progression: ['Cmaj7', 'Dm', 'G', 'Cmaj7'] },
  { type: 'mode', name: 'ionian', root: 'C' },
  
  // Random variations
  { type: 'scale', name: 'random', root: 'C' },           // Random scale, fixed root
  { type: 'scale', name: 'major', root: 'random' },       // Fixed scale, random root
  { type: 'chords', progression: 'random' },              // Random progression
  { type: 'mode', name: 'ionian', root: 'random' },       // Fixed mode, random root
  { type: 'mode', name: 'random', root: 'random' },       // Fully random mode
  
  // Pentatonic
  { type: 'pentatonic', root: 'C', scaleType: 'major' },  // Specific pentatonic
  { type: 'pentatonic', root: 'random', scaleType: 'random' },  // Random pentatonic
  
  // Advanced composers
  { type: 'tensionRelease', quality: 'major', tensionCurve: 0.6 },
  { type: 'modalInterchange', primaryMode: 'major', borrowProbability: 0.3 }
];
```

**Usage patterns:**

```javascript
// Instantiate all composers from config
const composers = COMPOSERS.map(config => ComposerFactory.create(config));

// Create specific composer
const composer = ComposerFactory.create({ 
  type: 'tensionRelease', 
  key: 'Eb', 
  quality: 'minor', 
  tensionCurve: 0.8 
});
```

---

## Integration with Other Modules

**play.js** ([code](../src/play.js)) ([doc](play.md))** ([code](../src/play.js ([code](../src/play.js)) ([doc](play.md)))) ([doc](play.md)) creates composer instances from COMPOSERS config:
```javascript
// Load from sheet.js config
const composers = COMPOSERS.map(config => ComposerFactory.create(config));
const composer = composers[ri(composers.length - 1)];

// Or create directly
const composer = ComposerFactory.create({ 
  type: 'scale', 
  name: 'random', 
  root: 'random' 
});
```

**play.js** ([code](../src/play.js)) ([doc](play.md))** ([code](../src/play.js ([code](../src/play.js)) ([doc](play.md)))) ([doc](play.md)) calls at each subdivision:
```javascript
setUnitTiming('subdivision');
const notes = composer.getNotes();  // Get 1-7 notes based on VOICES config
playNotes();  // Send MIDI note-ons
```

**time.js** ([code](../src/time.js)) ([doc](time.md))** ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)) calls for timing:
```javascript
divsPerBeat = composer.getDivisions();
subdivsPerDiv = composer.getSubdivisions();
numerator = composer.getNumerator();  // When changing meters
```

---

## Error Handling

- **Graceful degradation** - Errors caught and methods retry with fallback patterns

## Voice Leading Integration

**`MeasureComposer` subclasses support optional **voice leading optimization** for smooth melodic motion and professional voice management. See [voiceLeading.md](voiceLeading.md) for complete documentation.

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

For comprehensive documentation, see [voiceLeading.md](voiceLeading.md).
