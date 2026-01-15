# rhythm.js - Rhythmic Pattern Generation and Drum Programming

> **Source**: `src/rhythm.js`
> **Status**: Core Module - Rhythm Engine
> **Dependencies**: backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)), writer.js ([code](../src/writer.js)) ([doc](writer.md)), sheet.js ([code](../src/sheet.js)) ([doc](sheet.md))

## Overview

**rhythm.js** generates complex rhythmic patterns and drum sequences. It combines algorithmic pattern generation with sophisticated drum programming to create percussion that would be impossible for human drummers.

**Core Responsibilities:**
- **Drum sound mapping** - 25+ percussion sounds with realistic velocity ranges
- **Pattern generation** - Intelligent rhythm creation based on musical context
- **Humanization** - Random timing jitter, shuffle, and variation
- **Stutter effects** - Complex drum rolls and fills with velocity decay
- **Context-aware triggering** - Probability-based drum pattern selection

## Architecture Role

**rhythm.js** operates in the **pattern generation layer**:
- **play.js** ([code](../src/play.js)) ([doc](play.md)) - Calls playDrums() at each beat
- **stage.js** ([code](../src/stage.js)) ([doc](stage.md)) - Calls drummer() and playDrums() from stage audio functions
- **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md)) - Uses utilities (ri, rf, rv, clamp, modClamp)
- **time.js** ([code](../src/time.js)) ([doc](time.md)) - Uses timing variables (beatStart, tpBeat, numerator)

---

## Drum Sound Mapping: `drumMap`

Comprehensive percussion database with MIDI notes and velocity ranges:

```javascript
drumMap = {
  // Snares (8 variants, 66-111 velocity)
  'snare1': {note: 31, velocityRange: [99, 111]},
  'snare2': {note: 33, velocityRange: [99, 111]},
  'snare3': {note: 124, velocityRange: [77, 88]},
  // ... snare4-8 ...

  // Kicks (7 variants, 88-127 velocity - highest)
  'kick1': {note: 12, velocityRange: [111, 127]},
  'kick2': {note: 14, velocityRange: [111, 127]},
  'kick3': {note: 0, velocityRange: [99, 111]},
  // ... kick4-7 ...

  // Cymbals (4 variants, 66-77 velocity)
  'cymbal1': {note: 59, velocityRange: [66, 77]},
  // ... cymbal2-4 ...

  // Congas (5 variants, 66-77 velocity)
  'conga1': {note: 60, velocityRange: [66, 77]},
  // ... conga2-5 ...
};
```

**Organization:**
- **Snares**: 8 sounds with moderate-high velocities
- **Kicks**: 7 sounds with highest velocities for prominence
- **Cymbals**: 4 sounds for high-frequency texture
- **Congas**: 5 sounds for rhythmic variety

---

## Drum Generation: `drummer()`

Sophisticated function for generating drum events with timing jitter and stutter effects:

```javascript
drummer = (drumNames, beatOffsets, offsetJitter=rf(.1), stutterChance=.3,
          stutterRange=[2, m.round(rv(11, [2,3], .3))], stutterDecayFactor=rf(.9, 1.1)) => {
  
  // Normalize inputs
  if (drumNames === 'random') {
    const allDrums = Object.keys(drumMap);
    drumNames = [allDrums[m.floor(m.random() * allDrums.length)]];
    beatOffsets = [0];
  }
  const drums = Array.isArray(drumNames) ? drumNames : drumNames.split(',').map(d => d.trim());
  const offsets = Array.isArray(beatOffsets) ? beatOffsets : [beatOffsets];

  // Combine drums with offsets
  const combined = drums.map((drum, i) => ({
    drum,
    offset: offsets[i % offsets.length]
  }));

  // Randomize pattern order (70% chance)
  if (rf() < .7) {
    if (rf() < .5) {
      combined.reverse();
    } else {
      // Fisher-Yates shuffle
      for (let i = combined.length - 1; i > 0; i--) {
        const j = m.floor(m.random() * (i + 1));
        [combined[i], combined[j]] = [combined[j], combined[i]];
      }
    }
  }

  // Apply timing humanization
  const adjustedOffsets = combined.map(({ offset }) => {
    if (rf() < .3) return offset;  // 30% exact timing
    const jitter = offset + (m.random() < 0.5 ? -offsetJitter * rf(.5, 1) : offsetJitter * rf(.5, 1));
    return jitter - m.floor(jitter);  // Keep 0-1 range
  });

  // Generate drum events
  combined.forEach(({ drum }, i) => {
    const drumInfo = drumMap[drum];
    if (!drumInfo) return;

    const offset = adjustedOffsets[i];
    const tick = beatStart + offset * tpBeat;
    const [minVelocity, maxVelocity] = drumInfo.velocityRange;
    const velocity = ri(minVelocity, maxVelocity);

    // Main drum hit
    p(c, {tick: tick, type: 'on', vals: [drumCH, drumInfo.note, velocity]});

    // Stutter effect (probabilistic)
    if (rf() < stutterChance) {
      const numStutters = ri(...stutterRange);
      const stutterDuration = .25 * ri(1, 8) / numStutters;
      const isFadeIn = rf() < 0.7;

      for (let j = 0; j < numStutters; j++) {
        const stutterTick = beatStart + (offset + j * stutterDuration) * tpBeat;
        let currentVelocity;

        if (isFadeIn) {
          const fadeInMultiplier = stutterDecayFactor * (j / (numStutters * rf(0.4, 2.2) - 1));
          currentVelocity = clamp(m.min(maxVelocity, ri(33) + maxVelocity * fadeInMultiplier), 0, 127);
        } else {
          const fadeOutMultiplier = 1 - (stutterDecayFactor * (j / (numStutters * rf(0.4, 2.2) - 1)));
          currentVelocity = clamp(m.max(0, ri(33) + maxVelocity * fadeOutMultiplier), 0, 127);
        }

        p(c, {tick: stutterTick, type: 'on', vals: [drumCH, drumInfo.note, m.floor(currentVelocity)]});
      }
    }
  });
};
```

**Parameters:**
- **drumNames** - Array of drum types or 'random'
- **beatOffsets** - Timing offsets (0.0-1.0) within beat
- **offsetJitter** - Random timing variation (humanization)
- **stutterChance** - Probability of stutter effect (0.0-1.0)
- **stutterRange** - [min, max] stutter repetitions
- **stutterDecayFactor** - Velocity fade rate for stutters

**Algorithm:**
1. Normalize input to arrays
2. Combine drums with offsets
3. Randomize order (70% chance reversal or shuffle)
4. Apply timing jitter (30% exact, 70% humanized)
5. Generate main drum hits
6. Apply stutter effect with fade-in/fade-out

---

## Context-Aware Pattern: `playDrums()`

Intelligently selects drum patterns based on rhythmic and metrical context:

```javascript
playDrums = () => {
  if (beatIndex % 2 === 0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff*rf(2,3.5))*bpmRatio3) {
    // Even beats with active rhythm: kicks
    drummer(['kick1','kick3'], [0, .5]);
    
    // Extra kick on final beat of odd-meter measures
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['kick2','kick5'], [0, .5]);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff*rf(2,3.5))*bpmRatio3) {
    // Other active beats: complex pattern
    drummer(['snare1','kick4','kick7','snare4'], [0, .5, .75, .25]);
  } else if (beatIndex % 2 === 0) {
    // Even beats (inactive): random variation
    drummer('random');
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['snare5'], [0]);
    }
  } else {
    // Odd beats (inactive): snare
    drummer(['snare6'], [0]);
  }
};
```

**Musical Decision Logic:**

| Condition | Pattern | Purpose |
|-----------|---------|---------|
| Even beat + active rhythm | Kick pattern | Emphasize strong beats |
| Any beat + active rhythm | Complex pattern | Fill rhythmic moments |
| Even beat + inactive rhythm | Random drum | Humanize silence |
| Odd beat + inactive rhythm | Snare only | Minimal pattern |
| Odd measure final beat | Extra variation | Odd-meter accent |

**Probability Factors:**
- **Base: 0.3** - 30% base probability for drum generation
- **beatsOff scaling** - Higher after silent beats (fill compensation)
- **bpmRatio3 scaling** - Adjusts for tempo appropriateness
- **1/measuresPerPhrase** - Special fills at phrase boundaries

---

## Pattern Characteristics

### Humanization Techniques
1. **Timing jitter** - Micro-timing variations (30% exact, 70% ±offsetJitter)
2. **Pattern shuffling** - Random reordering of drum sequence
3. **Stutter variability** - Random stutter count (2-11 repetitions)
4. **Decay randomization** - Varying fade curves (0.4-2.2× stutterDecayFactor)

### Density Control
1. **Probability-based** - Base 30% triggers contextual variations
2. **Activity-dependent** - Higher when rhythms are less active
3. **Tempo-scaled** - Adjusts for musical tempo (bpmRatio3)
4. **Meter-aware** - Special handling for odd time signatures

### Velocity Dynamics
1. **Realistic ranges** - Each drum has natural velocity range
2. **Stutter decay** - Velocity fades during stutter effects
3. **Random variation** - ri() adds realistic swing to dynamics
4. **Channel isolation** - All drums on dedicated drumCH (channel 15)

---

## Integration with Composition

**Called from play.js beat loop:**
```javascript
for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
  setUnitTiming('beat');
  playNotes();     // Musical notes via stage.js
  playDrums();     // Drum patterns via rhythm.js
}
```

**Timing synchronization:**
- Drum events aligned to same beatStart used by notes
- Uses same tpBeat and numerator as melodic content
- Respects layer switching via LM.activate()

---

## Design Philosophy

**"Algorithmic Percussion"** - Creates realistic drum patterns through:
- Mathematical pattern generation (not random hits)
- Musical intelligence (context-aware triggering)
- Humanization (timing/velocity variation)
- Polyrhythmic awareness (odd meter handling)
- Probabilistic control (not deterministic)
