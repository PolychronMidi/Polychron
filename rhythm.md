# rhythm.js - Rhythmic Pattern Generation and Drum Programming System

## Project Overview

**rhythm.js** is the **rhythmic intelligence** of the Polychron system, responsible for creating complex rhythmic patterns, drum sequences, and polyrhythmic structures. This file combines algorithmic pattern generation with sophisticated drum programming to create rhythmic content that would be impossible for human performers.

## File Purpose

This module provides **advanced rhythmic capabilities** including:
- **Algorithmic rhythm generation** - Uses multiple mathematical approaches to create patterns
- **Drum mapping and sequencing** - Comprehensive percussion system with realistic velocity ranges
- **Pattern transformation** - Rotation, morphing, and variation of existing patterns
- **Euclidean rhythms** - Mathematically perfect rhythm distribution
- **Polyrhythmic pattern management** - Coordinates multiple simultaneous rhythm layers
- **Cross-rhythm tracking** - Monitors pattern interactions for musical decision-making

## Architecture Role

**rhythm.js** operates in the **pattern generation layer**, receiving requests from **play.js** for rhythmic patterns and returning arrays of rhythm values (0s and 1s). It integrates with:
- **@tonaljs/rhythm-pattern** library for algorithmic pattern generation
- **backstage.js** for utility functions and random number generation
- **time.js** for tempo and timing coordination
- **stage.js** for actual MIDI event generation

## Code Style Philosophy

Maintains the project's **"clean minimal"** approach:
- **Functional programming patterns** - Many operations use pure functions
- **Dense mathematical expressions** - Complex rhythm calculations in compact form
- **Direct array manipulation** - Efficient pattern operations
- **Integrated randomization** - Sophisticated probability-based decision making
- **Minimal abstraction** - Direct pattern generation without unnecessary layers

## Comprehensive Drum System

### `drumMap` Object - Percussion Sound Database
```javascript
drumMap = {
  'snare1': {note: 31, velocityRange: [99,111]},
  'snare2': {note: 33, velocityRange: [99,111]},
  'snare3': {note: 124, velocityRange: [77,88]},
  'snare4': {note: 125, velocityRange: [77,88]},
  'snare5': {note: 75, velocityRange: [77,88]},
  'snare6': {note: 85, velocityRange: [77,88]},
  'snare7': {note: 118, velocityRange: [66,77]},
  'snare8': {note: 41, velocityRange: [66,77]},

  'kick1': {note: 12, velocityRange: [111,127]},
  'kick2': {note: 14, velocityRange: [111,127]},
  'kick3': {note: 0, velocityRange: [99,111]},
  'kick4': {note: 2, velocityRange: [99,111]},
  'kick5': {note: 4, velocityRange: [88,99]},
  'kick6': {note: 5, velocityRange: [88,99]},
  'kick7': {note: 6, velocityRange: [88,99]},

  'cymbal1': {note: 59, velocityRange: [66,77]},
  'cymbal2': {note: 53, velocityRange: [66,77]},
  'cymbal3': {note: 80, velocityRange: [66,77]},
  'cymbal4': {note: 81, velocityRange: [66,77]},

  'conga1': {note: 60, velocityRange: [66,77]},
  'conga2': {note: 61, velocityRange: [66,77]},
  'conga3': {note: 62, velocityRange: [66,77]},
  'conga4': {note: 63, velocityRange: [66,77]},
  'conga5': {note: 64, velocityRange: [66,77]},
};
```

**Comprehensive drum categorization**:
- **Snares** (snare1-snare8): 8 different snare sounds with varying velocities (66-111)
- **Kicks** (kick1-kick7): 7 kick drum variations with highest velocities (88-127)
- **Cymbals** (cymbal1-cymbal4): 4 cymbal types with moderate velocities (66-77)
- **Congas** (conga1-conga5): 5 conga drums for Latin/world music elements (66-77)

### `drummer()` Function - Advanced Drum Pattern Engine
```javascript
drummer = (drumNames, beatOffsets, offsetJitter=rf(.1), stutterChance=.3,
          stutterRange=[2,m.round(rv(11,[2,3],.3))], stutterDecayFactor=rf(.9,1.1)) => {
```

**Sophisticated parameter system**:
- **drumNames** - Array of drum types or 'random' for automatic selection
- **beatOffsets** - Timing offsets within the beat (0.0 to 1.0)
- **offsetJitter** - Random timing variation amount for humanization
- **stutterChance** - Probability of stutter effects (0.0 to 1.0)
- **stutterRange** - [min, max] number of stutter repetitions
- **stutterDecayFactor** - Volume fade rate for stutters

#### Random Drum Selection Logic
```javascript
if (drumNames === 'random') {
  const allDrums = Object.keys(drumMap);
  drumNames = [allDrums[m.floor(m.random() * allDrums.length)]];
  beatOffsets = [0];
}
const drums = Array.isArray(drumNames) ? drumNames : drumNames.split(',').map(d=>d.trim());
const offsets = Array.isArray(beatOffsets) ? beatOffsets : [beatOffsets];
```
- **Flexible input handling** - accepts arrays, strings, or 'random'
- **Automatic selection** - randomly picks from all available drums
- **Array normalization** - converts single values to arrays for consistent processing

#### Pattern Randomization System
```javascript
if (rf() < .7) { // Reverse or randomize the order of drums and offsets
  if (rf() < .5) {
    combined.reverse();
  }
} else {
  for (let i = combined.length - 1; i > 0; i--) {
    const j = m.floor(m.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
}
```
- **70% chance of pattern modification** - keeps some patterns unchanged
- **50/50 split** between reversal and complete shuffling
- **Fisher-Yates shuffle** for random reordering
- **Maintains drum-offset relationships** during reordering

#### Advanced Timing Jitter
```javascript
const adjustedOffsets = combined.map(({ offset }) => {
  if (rf() < .3) {
    return offset;  // 30% chance of exact timing
  } else {
    let adjusted = offset + (m.random() < 0.5 ? -offsetJitter*rf(.5,1) : offsetJitter*rf(.5,1));
    return adjusted - m.floor(adjusted);  // Keep in 0-1 range
  }
});
```
- **Humanization through micro-timing** - prevents mechanical feel
- **30% exact timing** for musical anchor points
- **70% jittered timing** with random direction and amount
- **Modulo arithmetic** keeps offsets within beat boundaries

#### Sophisticated Stutter Effect Generation
```javascript
if (rf() < stutterChance) {
  const numStutters = ri(...stutterRange);
  const stutterDuration = .25 * ri(1,8) / numStutters;
  const [minVelocity, maxVelocity] = drumInfo.velocityRange;
  const isFadeIn = rf() < 0.7;

  for (let i = 0; i < numStutters; i++) {
    const tick = beatStart + (offset + i * stutterDuration) * tpBeat;
    let currentVelocity;
    if (isFadeIn) {
      const fadeInMultiplier = stutterDecayFactor * (i / (numStutters*rf(0.4,2.2) - 1));
      currentVelocity = clamp(m.min(maxVelocity, ri(33) + maxVelocity * fadeInMultiplier), 0, 127);
    } else {
      const fadeOutMultiplier = 1 - (stutterDecayFactor * (i / (numStutters*rf(0.4,2.2) - 1)));
      currentVelocity = clamp(m.max(0, ri(33) + maxVelocity * fadeOutMultiplier), 0, 127);
    }
    p(c, {tick:tick, type:'on', vals:[drumCH, drumInfo.note, m.floor(currentVelocity)]});
  }
}
```
- **Probability-based triggering** via stutterChance parameter
- **Variable stutter count** from stutterRange
- **Dynamic duration calculation** - shorter duration for more stutters
- **Fade direction choice** - 70% chance of fade-in vs fade-out
- **Complex velocity calculation** with decay factor modulation and randomization
- **Direct MIDI event generation** for each stutter hit

### Context-Aware Drum Programming

#### `playDrums()` - Primary Drum Patterns
```javascript
playDrums = () => {
  if (beatIndex % 2 === 0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['kick1','kick3'], [0, .5]);
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['kick2','kick5'], [0, .5]);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['snare1','kick4','kick7','snare4'], [0, .5, .75, .25]);
  } else if (beatIndex % 2 === 0) {
    drummer('random');
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['snare5'], [0]);
    }
  } else {
    drummer(['snare6'], [0]);
  }
};
```

**Intelligent drum programming logic**:
- **Even beat emphasis** - kicks on beats 2, 4, 6, etc.
- **Rhythm pattern awareness** - only plays when beat rhythm is active
- **Statistical control** - 30% base probability with dynamic modifiers
- **Beat-off compensation** - higher probability after silent beats via `beatsOff*rf(2,3.5)`
- **BPM scaling** - probability adjusts with `bpmRatio3` for tempo appropriateness
- **Odd meter special cases** - extra patterns on final beat of odd-numbered measures
- **Complex pattern combinations** - multiple drums with precise timing offsets

#### `playDrums2()` - Polyrhythmic Drum Patterns
```javascript
playDrums2 = () => {
  if (beatIndex % 2 === 0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['kick2','kick5','kick7'], [0, .5, .25]);
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['kick1','kick3','kick7'], [0, .5, .25]);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['snare2','kick6','snare3'], [0, .5, .75]);
  } else if (beatIndex % 2 === 0) {
    drummer(['snare7'], [0]);
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['snare7'], [0]);
    }
  } else {
    drummer('random');
  }
};
```
- **Complementary patterns** to playDrums() for polyrhythmic sections
- **Different drum selections** - avoids identical patterns in both sections
- **Similar probability structure** but with different drum combinations
- **Interlocking rhythmic design** - patterns that complement rather than compete

## Advanced Algorithmic Pattern Generation

### Pattern Algorithm Registry
```javascript
rhythms = { //weights: [beat,div,subdiv]
  'binary':{weights:[2,3,1], method:'binary', args:(length)=>[length]},
  'hex':{weights:[2,3,1], method:'hex', args:(length)=>[length]},
  'onsets':{weights:[5,0,0], method:'onsets', args:(length)=>[{make:[length,()=>[1,2]]}]},
  'onsets2':{weights:[0,2,0], method:'onsets', args:(length)=>[{make:[length,[2,3,4]]}]},
  'onsets3':{weights:[0,0,7], method:'onsets', args:(length)=>[{make:[length,()=>[3,7]]}]},
  'random':{weights:[7,0,0], method:'random', args:(length)=>[length,rv(.97,[-.1,.3],.2)]},
  'random2':{weights:[0,3,0], method:'random', args:(length)=>[length,rv(.9,[-.3,.3],.3)]},
  'random3':{weights:[0,0,1], method:'random', args:(length)=>[length,rv(.6,[-.3,.3],.3)]},
  'euclid':{weights:[3,3,3], method:'euclid', args:(length)=>[length,closestDivisor(length,m.ceil(rf(2,length/rf(1,1.2))))]},
  'rotate':{weights:[2,2,2], method:'rotate', args:(length,pattern)=>[pattern,ri(2),'?',length]},
  'morph':{weights:[2,3,3], method:'morph', args:(length,pattern)=>[pattern,'?',length]}
};
```

**Hierarchical algorithm weighting**:
- **Beat level algorithms** - Focus on 'onsets', 'random', and 'euclid'
- **Division level algorithms** - Emphasize 'binary', 'hex', 'onsets2', 'random2'
- **Subdivision level algorithms** - Highlight 'onsets3', 'random3', 'morph'
- **Multi-level algorithms** - 'euclid', 'rotate', 'morph' work at all levels

### Core Algorithm Implementations

#### `binary(length)` and `hex(length)` - Deterministic Pattern Generation
```javascript
binary = (length) => {
  let pattern = [];
  while (pattern.length < length) {
    pattern = pattern.concat(_binary(ri(99)));
  }
  return patternLength(pattern, length);
};
hex = (length) => {
  let pattern = [];
  while (pattern.length < length) {
    pattern = pattern.concat(_hex(ri(99).toString(16)));
  }
  return patternLength(pattern, length);
};
```
- **Uses @tonaljs/rhythm-pattern** for core algorithms
- **Random seed generation** (0-99) for pattern variety
- **Pattern concatenation** until desired length is reached
- **Length normalization** ensures exact output length
- **Hexadecimal conversion** creates different pattern characteristics

#### `euclid(length, ones)` - Mathematically Perfect Distribution
```javascript
euclid = (length, ones) => { return _euclid(length, ones); };
```
- **Direct wrapper** for Tonal.js Euclidean algorithm
- **Mathematically optimal distribution** of rhythm hits across time
- **Used extensively** in traditional music worldwide (Cuban clave, African polyrhythms)
- **Parameters**: length (total beats) and ones (number of hits to distribute)

#### `random(length, probOn)` - Probabilistic Pattern Generation
```javascript
random = (length, probOn) => { return _random(length, 1 - probOn); };
```
- **Probability-based rhythm generation**
- **probOn parameter** controls density of rhythm hits
- **Different probability ranges** for different hierarchical levels
- **Creates organic, non-mechanical patterns**

### Advanced Pattern Transformation Functions

#### `rotate(pattern, rotations, direction, length)` - Circular Pattern Shifting
```javascript
rotate = (pattern, rotations, direction="R", length=pattern.length) => {
  if (direction === '?') { direction = rf() < .5 ? 'L' : 'R'; }
  if (direction.toUpperCase() === 'L') {
    rotations = (pattern.length - rotations) % pattern.length;
  }
  return patternLength(_rotate(pattern, rotations), length);
};
```
- **Circular pattern shifting** - moves pattern start point
- **Bidirectional rotation** - left ('L') or right ('R') direction
- **Random direction option** ('?') for unpredictable variations
- **Mathematical rotation calculation** handles wraparound correctly
- **Length adjustment** maintains desired pattern length

#### `morph(pattern, direction, length, probLow, probHigh)` - Probabilistic Evolution
```javascript
morph = (pattern, direction='both', length=pattern.length, probLow=.1, probHigh) => {
  probHigh = probHigh === undefined ? probLow : probHigh;
  let morpheus = pattern.map((v, index) => {
    let morph = probHigh === probLow ? rf(probLow) : rf(probLow, probHigh);
    let _ = ['up','down','both'];
    let d = direction === '?' ? (_[ri(_.length - 1)]) : direction.toLowerCase();
    let up = v < 1 ? m.min(v + morph, 1) : v;
    let down = v > 0 ? m.max(v - morph, 0) : v;
    return (d === 'up' ? up : d === 'down' ? down : d === 'both' ? (v < 1 ? up : down) : v);
  });
  return prob(patternLength(morpheus, length));
};
```
- **Probabilistic pattern modification** - gradually changes existing patterns
- **Directional morphing** - 'up', 'down', 'both', or random ('?')
- **Probability range control** - variable morphing intensity via probLow/probHigh
- **Continuous pattern evolution** - smooth transitions between rhythmic states
- **Probability conversion** - final step converts morph values to binary rhythm

### Dynamic Rhythm Selection System

#### `setRhythm(level)` - Hierarchical Pattern Assignment
```javascript
setRhythm = (level) => {
  switch(level) {
    case 'beat':
      return beatRhythm = beatRhythm < 1 ? _random(numerator) : getRhythm('beat', numerator, beatRhythm);
    case 'div':
      return divRhythm = divRhythm < 1 ? _random(divsPerBeat, .4) : getRhythm('div', divsPerBeat, divRhythm);
    case 'subdiv':
      return subdivRhythm = subdivRhythm < 1 ? _random(subdivsPerDiv, .3) : getRhythm('subdiv', subdivsPerDiv, subdivRhythm)
    default: throw new Error('Invalid level provided to setRhythm');
  }
};
```
- **Hierarchical level mapping** - different algorithms for beat/division/subdivision
- **Pattern initialization** - creates initial random patterns when needed
- **Dynamic algorithm selection** - uses getRhythm() for sophisticated pattern generation
- **Default probability values** - decreasing density at deeper levels (.4, .3)

#### `getRhythm(level, length, pattern, method, ...args)` - Intelligent Algorithm Selection
```javascript
getRhythm = (level, length, pattern, method, ...args) => {
  const levelIndex = ['beat','div','subdiv'].indexOf(level);
  const filteredRhythms = Object.fromEntries(
    Object.entries(rhythms).filter(([_, { weights }]) => weights[levelIndex] > 0)
  );
  const rhythmKey = randomWeightedSelection(filteredRhythms);
  if (rhythmKey && rhythms[rhythmKey]) {
    const { method: rhythmMethodKey, args: rhythmArgs } = rhythms[rhythmKey];
    const rhythmMethod = global[rhythmMethodKey];
    if (rhythmMethod) return rhythmMethod(...rhythmArgs(length, pattern));
  }
  return null;
};
```
- **Level-specific filtering** - only uses algorithms weighted for current level
- **Weighted random selection** - probability-based algorithm choice based on weights
- **Dynamic parameter passing** - forwards appropriate arguments to selected algorithm
- **Method validation** - ensures rhythm functions exist before calling
- **Musical appropriateness** - different algorithms favored at different hierarchical levels

### Utility Functions for Pattern Processing

#### `makeOnsets(length, valuesOrRange)` - Onset-Based Rhythm Construction
```javascript
makeOnsets = (length, valuesOrRange) => {
  let onsets = []; let total = 0;
  while (total < length) {
    let v = ra(valuesOrRange);
    if (total + (v+1) <= length) {
      onsets.push(v);
      total += v+1;
    } else if (Array.isArray(valuesOrRange) && valuesOrRange.length === 2) {
      v = valuesOrRange[0];
      if (total + (v+1) <= length) { onsets.push(v); total += v+1; }
      break;
    } else { break; }
  }
  let rhythm = [];
  for (let onset of onsets) {
    rhythm.push(1);
    for (let i = 0; i < onset; i++) { rhythm.push(0); }
  }
  while (rhythm.length < length) { rhythm.push(0); }
  return rhythm;
};
```
- **Onset-based rhythm construction** - specifies gaps between hits rather than hit positions
- **Length validation** - ensures pattern fits within specified length
- **Flexible input handling** - accepts arrays, ranges, or function specifications
- **Pattern conversion** - transforms onset specifications to binary rhythm arrays
- **Padding** - fills remaining length with zeros if needed

#### `closestDivisor(x, target)` - Mathematical Optimization for Euclidean Rhythms
```javascript
closestDivisor = (x, target=2) => {
  let closest = Infinity;
  let smallestDiff = Infinity;
  for (let i = 1; i <= m.sqrt(x); i++) {
    if (x % i === 0) {
      [i, x / i].forEach(divisor => {
        if (divisor !== closest) {
          let diff = m.abs(divisor - target);
          if (diff < smallestDiff) {smallestDiff = diff; closest = divisor;}
        }
      });
    }
  }
  if (closest === Infinity) { return x; }
  return x % target === 0 ? target : closest;
};
```
- **Mathematical divisor finding** for optimal Euclidean rhythm parameters
- **Target-based selection** - finds divisor closest to desired value
- **Efficiency optimization** - only checks divisors up to square root
- **Perfect divisor preference** - chooses target if it divides evenly
- **Fallback handling** - returns original value if no suitable divisor found

### Pattern State Tracking Functions

#### `trackBeatRhythm()` and `trackDivRhythm()` - Cross-Modulation Data
```javascript
trackBeatRhythm = () => {if (beatRhythm[beatIndex] > 0) {beatsOn++; beatsOff=0;} else {beatsOn=0; beatsOff++;} };
trackDivRhythm = () => {if (divRhythm[divIndex] > 0) {divsOn++; divsOff=0;} else {divsOn=0; divsOff++;} };
```
- **State monitoring** - tracks consecutive on/off patterns at each level
- **Cross-modulation data** - provides information for musical decision-making in stage.js
- **Reset counters** - maintains accurate statistics across pattern boundaries
- **Used by crossModulateRhythms()** for sophisticated note generation decisions

## Integration with Musical Hierarchy

**rhythm.js** generates patterns at three main hierarchical levels:
1. **Beat Level** - Primary pulse patterns (typically 2-11 beats per measure)
2. **Division Level** - Beat subdivisions (typically 0-10 divisions per beat)
3. **Subdivision Level** - Sub-beat patterns (typically 0-10 subdivisions per division)

Each level uses **different algorithm weights** and **probability distributions** to create musically appropriate rhythmic complexity:
- **Beat level** - Favors simpler, more grounded patterns (onsets, random, euclid)
- **Division level** - Uses intermediate complexity (binary, hex, onsets2)
- **Subdivision level** - Allows maximum complexity (onsets3, morph, random3)

## Performance Characteristics

- **Real-time pattern generation** - All patterns created on-demand during composition
- **Computational efficiency** - Pattern algorithms optimized for speed
- **Memory efficiency** - Patterns stored as compact binary arrays
- **Musical variety** - Millions of possible rhythmic combinations through algorithmic diversity
- **Human-impossible complexity** - Generates patterns too intricate for human performance
- **MIDI-optimized output** - All timing calculations produce precise MIDI tick values

## CSVBuffer Integration

**rhythm.js** uses the global `c` buffer for MIDI event generation:
- **drummer() and playDrums()** - Push events directly to active CSVBuffer via `p(c, ...)`
- **Layer awareness** - Active buffer (c) automatically set by LM.activate()
- **No layer logic needed** - Rhythm functions work with whichever layer is currently active
- **Preserves minimalism** - Same `p(c)` syntax works across all layers

This transparent layer switching enables identical rhythm code to generate events for both primary and poly layers.

## Revolutionary Aspects

### Algorithmic Sophistication
**rhythm.js** combines multiple academic rhythm generation algorithms in a single system, creating unprecedented rhythmic variety.

### Hierarchical Complexity
The **3-level rhythm generation** (beat/division/subdivision) creates rhythmic detail impossible to achieve through traditional composition methods.

### Intelligent Drum Programming
The **context-aware drum patterns** respond to rhythmic states and musical flow, creating organic-feeling percussion despite algorithmic generation.

### Pattern Evolution
**Transformation functions** (rotate, morph) allow patterns to evolve over time, preventing mechanical repetition while maintaining rhythmic coherence.
