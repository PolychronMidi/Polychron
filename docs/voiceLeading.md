# Voice Leading & Counterpoint (Task 3.3)

## Overview

Voice leading is the musical art of smoothly connecting notes across voices, minimizing large leaps and awkward voice crossing. This implementation provides a **cost function optimizer** that scores candidate notes using weighted penalties for common voice leading violations.

## Cost Function Approach

The `VoiceLeadingScore` class implements **soft constraints** through a cost-based scoring system, not hard rules. This allows flexibility while gently encouraging better voice leading:

```
Total Cost = (smoothness_cost × weight) + (range_cost × weight) +
             (leap_recovery_cost × weight) + (crossing_cost × weight) +
             (parallel_cost × weight)
```

Lower cost = better note choice. Notes are evaluated and the **minimum cost option is selected**.

## Key Rules Implemented

### 1. Smooth Voice Motion (Weight: 1.0)
Prefers stepwise motion (1-2 semitones) over larger leaps:

| Interval | Motion Type | Cost |
|----------|-------------|------|
| 0 | Unison | 0 |
| 1-2 | Step | 1 |
| 3-5 | Small leap | 3 |
| 6-7 | Tritone/sixth | 5 |
| 8+ | Large leap | 10 |

**Example:**
```javascript
// From C (60), selecting next note:
scorer.selectNextNote([60], [58, 59, 61, 62, 72]);
// Returns 61 or similar (step) instead of 72 (large leap)
```

### 2. Voice Range Enforcement (Weight: 0.8)
Keeps notes within comfortable registers:

```javascript
// Standard registers (MIDI note numbers)
soprano: [60, 84]    // C4 to C6
alto: [48, 72]       // C3 to C5
tenor: [36, 60]      // C2 to C4
bass: [24, 48]       // C1 to C3
```

Scoring:
- Middle half of range: **0 cost** (ideal)
- Within range: **2 cost** (acceptable)
- Outside range: **2 + (distance × 0.5) cost** (discouraged)

### 3. Leap Recovery (Weight: 0.6)
Enforces the classical rule: **"Leaps must be followed by stepwise motion in the opposite direction"**

- No penalty if previous motion was a step
- **5 cost** if leap not followed by step
- **0 cost** if leap recovery follows opposite direction
- **2 cost** if same direction (mild penalty)

### 4. Voice Crossing Prevention (Weight: 0.4)
In multi-voice texture, soprano should not cross below alto:

```javascript
// 4-voice (SATB):
lastNotes = [72, 60, 48, 36]  // S A T B
candidate = 55  // Below alto
cost = 6  // Penalized for crossing
```

### 5. Parallel Motion Avoidance (Weight: 0.3)
Discourages repeated directional motion (soft constraint):

```javascript
if (motion_direction === last_motion_direction) {
  cost = 3  // Mild penalty for parallel
}
```

## API Reference

### Class: `VoiceLeadingScore`

#### Constructor
```javascript
const scorer = new VoiceLeadingScore({
  smoothMotionWeight: 1.0,      // Default
  voiceRangeWeight: 0.8,        // Default
  leapRecoveryWeight: 0.6,      // Default
  voiceCrossingWeight: 0.4,     // Default
  parallelMotionWeight: 0.3,    // Default
});
```

#### Methods

**`selectNextNote(lastNotes, availableNotes, config)`**
- **Parameters:**
  - `lastNotes`: `number[]` — Previous notes [soprano, alto, tenor, bass, ...]
  - `availableNotes`: `number[]` — Pool of MIDI notes to choose from
  - `config`: `object` — Optional voice context
    - `register`: `'soprano'|'alto'|'tenor'|'bass'` — Voice type
    - `constraints`: `string[]` — Hard constraints: `'avoidsStrident'`, `'stepsOnly'`
- **Returns:** `number` — Best scoring note
- **Tracks history** automatically for context-aware scoring

**Example:**
<!-- BEGIN: snippet:VoiceLeading_selectNextNote -->

```javascript
  /**
   * Scores all available notes and returns the best candidate.
   * @param {number[]} lastNotes - Previous notes [soprano, alto, tenor, bass]
   * @param {number[]} availableNotes - Pool of candidate notes to evaluate
   * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
   * @returns {number} Best scoring note
   */
  selectNextNote(lastNotes, availableNotes, config = {}) {
    if (!availableNotes || availableNotes.length === 0) {
      return lastNotes[0] ?? 60; // Fallback to C4
    }

    const register = config.register || 'soprano';
    const constraints = config.constraints || [];
    const registerRange = this.registers[register] || this.registers.soprano;

    // Score each candidate
    const scores = availableNotes.map((note) => ({
      note,
      score: this._scoreCandidate(note, lastNotes, registerRange, constraints),
    }));

    // Sort by score (lower is better) and return best
    scores.sort((a, b) => a.score - b.score);
    const bestNote = scores[0].note;

    // Track history for context
    this._updateHistory(bestNote, register);

    return bestNote;
  }
```

<!-- END: snippet:VoiceLeading_selectNextNote -->

**`analyzeQuality(noteSequence)`**
- **Parameters:** `noteSequence`: `number[]` — Sequence to evaluate
- **Returns:** Object with metrics:
  - `smoothness`: Average motion cost per interval
  - `avgRange`: Average MIDI note value
  - `leapRecoveries`: Ratio of successful leap recoveries
- **Use case:** Post-hoc validation of generated sequences

**Example:**
<!-- BEGIN: snippet:VoiceLeading_analyzeQuality -->

```javascript
  /**
   * Analyzes voice leading quality of a sequence.
   * Useful for post-hoc validation or constraint scoring.
   * @param {number[]} noteSequence - Sequence of notes to analyze
   * @returns {{ smoothness: number, avgRange: number, leapRecoveries: number }}
   */
  analyzeQuality(noteSequence) {
    if (noteSequence.length < 2) {
      return { smoothness: 0, avgRange: 0, leapRecoveries: 0 };
    }

    let totalCost = 0;
    let leapCount = 0;
    let recoveryCount = 0;

    for (let i = 1; i < noteSequence.length; i++) {
      const interval = Math.abs(noteSequence[i] - noteSequence[i - 1]);
      const motionCost = this._scoreVoiceMotion(interval, noteSequence[i - 1], noteSequence[i]);
      totalCost += motionCost;

      if (interval > 2) leapCount++;
      if (i >= 2 && interval <= 2 && Math.abs(noteSequence[i - 1] - noteSequence[i - 2]) > 2) {
        recoveryCount++;
      }
    }

    return {
      smoothness: totalCost / (noteSequence.length - 1),
      avgRange: noteSequence.reduce((a, b) => a + b, 0) / noteSequence.length,
      leapRecoveries: leapCount > 0 ? recoveryCount / leapCount : 1.0,
    };
  }
```

<!-- END: snippet:VoiceLeading_analyzeQuality -->

**`reset()`**
- Clears historical tracking
- Call at section boundaries

### Integration with Composer Classes

The `MeasureComposer` base class (and all subclasses) now support voice leading:

#### Methods Added to Composers

**`enableVoiceLeading(scorer?)`**
```javascript
const composer = new ScaleComposer('major', 'C');
composer.enableVoiceLeading();  // Uses default scorer
// or
composer.enableVoiceLeading(customScorer);
```

**`selectNoteWithLeading(availableNotes, config?)`**
```javascript
const candidates = [60, 62, 64, 65, 67];
const selectedNote = composer.selectNoteWithLeading(candidates, {
  register: 'soprano'
});
```

**`resetVoiceLeading()`**
```javascript
composer.resetVoiceLeading();  // Clear history at section breaks
```

## Integration Patterns

### Pattern 1: Opt-in Voice Leading per Voice

Enable only when composing specific voices (e.g., soprano lines):

```javascript
// In play.js or wherever composers are used
const sopranoComposer = ComposerFactory.create({
  type: 'scale',
  name: 'major',
  root: 'C'
});

// Enable voice leading for smooth soprano line
sopranoComposer.enableVoiceLeading();

// When generating soprano notes:
const notes = sopranoComposer.getNotes(); // Standard: random from scale
const smoothNotes = notes.map(({note}) =>
  sopranoComposer.selectNoteWithLeading([note])
);
```

### Pattern 2: Register-Specific Constraints

Apply different rules per voice:

```javascript
const soprano = new ScaleComposer('major', 'C');
const alto = new ScaleComposer('major', 'C');
const tenor = new ScaleComposer('major', 'C');
const bass = new ScaleComposer('major', 'C');

soprano.enableVoiceLeading();
alto.enableVoiceLeading();
tenor.enableVoiceLeading();
bass.enableVoiceLeading();

// Generate smooth 4-voice harmony
const sopranoNote = soprano.selectNoteWithLeading(candidates, {register: 'soprano'});
const altoNote = alto.selectNoteWithLeading(candidates, {register: 'alto'});
const tenorNote = tenor.selectNoteWithLeading(candidates, {register: 'tenor'});
const bassNote = bass.selectNoteWithLeading(candidates, {register: 'bass'});
```

### Pattern 3: Section-Based Reset

Reset voice leading history at major section boundaries:

```javascript
// In play.js measure processing loop
if (isNewSection) {
  sopranoComposer.resetVoiceLeading();  // Clear history at section start
  altoComposer.resetVoiceLeading();
  tenorComposer.resetVoiceLeading();
  bassComposer.resetVoiceLeading();
}
```

### Pattern 4: Hard Constraints for Expression

Apply constraints to style compositional choices:

```javascript
// Lyrical, smooth style
const lyrical = new ScaleComposer('major', 'C');
lyrical.enableVoiceLeading();
lyrical.selectNoteWithLeading(candidates, {
  constraints: ['stepsOnly']  // Force stepwise throughout
});

// Dramatic style with jumps
const dramatic = new ScaleComposer('major', 'C');
dramatic.enableVoiceLeading();
dramatic.selectNoteWithLeading(candidates, {
  constraints: ['avoidsStrident']  // Only mild leap avoidance
});
```

## Cost Function Deep Dive

### How the Score is Calculated

For each candidate note, the scorer:

1. **Computes motion smoothness** based on interval size
2. **Checks register bounds** (higher penalty for extremes)
3. **Evaluates leap recovery** (if previous was a leap, prefer step)
4. **Detects voice crossing** (multi-voice context)
5. **Calculates parallel motion** (soft constraint from history)
6. **Applies hard constraints** (100% penalties if violated)

All costs are **multiplied by tunable weights**, summed, and the **minimum cost wins**.

### Customizing Weights

Adjust weights to emphasize different rules:

```javascript
const conservative = new VoiceLeadingScore({
  smoothMotionWeight: 2.0,      // Heavily prefer steps
  leapRecoveryWeight: 1.5,      // Strict leap recovery
  voiceCrossingWeight: 2.0,     // Forbid crossing
  voiceRangeWeight: 1.0         // Respect register
});

const expressive = new VoiceLeadingScore({
  smoothMotionWeight: 0.5,      // Allow some leaps
  leapRecoveryWeight: 0.2,      // Weak recovery rule
  voiceCrossingWeight: 0.2,     // Allow occasional crossing
  parallelMotionWeight: 0        // Ignore parallel motion
});
```

## Testing

Comprehensive test suite in [test/voiceLeading.test.js](../test/voiceLeading.test.js):

- **35+ unit tests** covering all cost functions
- **Voice leading rule validation** (smooth motion, range, leap recovery, crossing)
- **Composer integration tests** (enableVoiceLeading, selectNoteWithLeading)
- **Quality analysis** (analyzing existing sequences)
- **State management** (history tracking, reset)

Run tests:
```bash
npm test voiceLeading.test.js
```

## Examples

### Example 1: Simple Melody with Voice Leading

```javascript
// Create a C major scale composer
const composer = new ScaleComposer('major', 'C');
composer.enableVoiceLeading();

// Scale degrees in C major (C D E F G A B)
const scaleNotes = [0, 2, 4, 5, 7, 9, 11];

// Generate smooth melody
const melody = [];
for (const degree of scaleNotes) {
  const midi = 60 + degree;  // Convert to MIDI
  const nextNote = composer.selectNoteWithLeading([midi, midi + 12], {
    register: 'soprano'
  });
  melody.push(nextNote);
}

// Result: smooth stepwise melody, occasional leaps with recovery
console.log(melody);  // [60, 62, 64, 65, 67, 69, 71, ...]
```

### Example 2: Harmonic Progression with Voice Leading

```javascript
const progression = new ChordComposer(['C', 'F', 'G', 'C']);
progression.enableVoiceLeading();

// For each chord, generate smooth soprano line
const chords = ['C', 'F', 'G', 'C'];
const soprano = [];

for (const chord of chords) {
  progression.noteSet([chord]);
  const notes = progression.getNotes();
  const midiNotes = notes.map(({note}) => note);

  const bestNote = progression.selectNoteWithLeading(midiNotes, {
    register: 'soprano'
  });
  soprano.push(bestNote);
}

console.log(soprano);  // Smooth soprano line through chords
```

### Example 3: Quality Analysis

```javascript
const analyzer = new VoiceLeadingScore();

// Evaluate an existing melody
const melody1 = [60, 61, 62, 61, 60];  // Smooth
const melody2 = [60, 72, 60, 72];      // Leap-heavy

const quality1 = analyzer.analyzeQuality(melody1);
const quality2 = analyzer.analyzeQuality(melody2);

console.log('Smooth melody:', quality1);
// { smoothness: 1.0, avgRange: 60.8, leapRecoveries: 1.0 }

console.log('Leap-heavy melody:', quality2);
// { smoothness: 6.5, avgRange: 66, leapRecoveries: 0.5 }
```

## Dependencies

- Requires `composers.js` (MeasureComposer base class)
- Requires `venue.js` globals (for note/scale/chord data)
- No external libraries

## Performance

- `selectNextNote()`: **O(n)** where n = candidate pool size (typically 5-12)
- `analyzeQuality()`: **O(n)** where n = sequence length
- Memory: **~1KB per scorer instance** (history tracking only)

Suitable for real-time composition in play.js measures/beats/subdivisions.

## Future Extensions

1. **Harmonic Analysis**: Consider note function (root, third, fifth) in scoring
2. **Melody Contour**: Penalize/reward specific shapes (arch, wave, etc.)
3. **Constraint Propagation**: Multi-voice constraint satisfaction (MIDI export)
4. **Machine Learning**: Learn weights from analysis of existing compositions
5. **Performance Optimization**: Memoize scores for repeated candidates

## See Also

- [composers.md](composers.md) — Composer factory with voice leading integration
- [stage.md](stage.md) — MIDI event generation and audio processing
- [play.md](play.md) — Main composition orchestrator
- [time.md](time.md) — Timing engine and meter spoofing
- [README.md](../README.md) — Project overview and all 10 modules
