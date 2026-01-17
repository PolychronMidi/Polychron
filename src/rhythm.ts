// rhythm.ts - Rhythmic pattern generation with drum mapping and stutter effects.
// minimalist comments, details at: rhythm.md

// Import rhythm pattern utilities
import * as RhythmPattern from '@tonaljs/rhythm-pattern';

// Global function declarations (these exist on globalThis from backstage.ts)
declare const m: typeof Math;
declare const p: (channel: number, event: any) => void;
declare const rf: (min?: number, max?: number) => number;
declare const ra: (value: any) => any;
declare const ri: (...args: number[]) => number;
declare const rv: (value: any, range?: number[], weight?: number) => number;
declare const rw: (min: number, max: number, weights?: number[]) => number;
declare const randomWeightedSelection: (obj: any) => string;
declare const clamp: (value: number, min: number, max: number) => number;

// Global variables from the composition system
declare const c: number; // MIDI channel
declare let beatStart: number;
declare let tpBeat: number; // ticks per beat
declare let drumCH: number;
declare let beatIndex: number;
declare let beatRhythm: number[];
declare let numerator: number;
declare let measuresPerPhrase: number;
declare let bpmRatio: number;
declare let bpmRatio3: number;
declare let divsPerBeat: number;
declare let divIndex: number;
declare let divRhythm: number[];
declare let subdivsPerDiv: number;
declare let subdivIndex: number;
declare let subdivRhythm: number[];
declare let subsubsPerSub: number;
declare let subsubdivIndex: number;
declare let subsubdivRhythm: number[];
declare let beatsOn: number;
declare let beatsOff: number;
declare let divsOn: number;
declare let divsOff: number;
declare let subdivsOn: number;
declare let subdivsOff: number;
declare let subsubdivsOn: number;
declare let subsubdivsOff: number;

/**
 * Type for drum configuration
 */
interface DrumInfo {
  note: number;
  velocityRange: [number, number];
}

/**
 * Type for drum map
 */
interface DrumMap {
  [key: string]: DrumInfo;
}

/**
 * Drum sound mapping with MIDI notes and velocities
 */
export const drumMap: DrumMap = {
  'snare1': {note: 31,velocityRange: [99,111]},
  'snare2': {note: 33,velocityRange: [99,111]},
  'snare3': {note: 124,velocityRange: [77,88]},
  'snare4': {note: 125,velocityRange: [77,88]},
  'snare5': {note: 75,velocityRange: [77,88]},
  'snare6': {note: 85,velocityRange: [77,88]},
  'snare7': {note: 118,velocityRange: [66,77]},
  'snare8': {note: 41,velocityRange: [66,77]},

  'kick1': {note: 12,velocityRange: [111,127]},
  'kick2': {note: 14,velocityRange: [111,127]},
  'kick3': {note: 0,velocityRange: [99,111]},
  'kick4': {note: 2,velocityRange: [99,111]},
  'kick5': {note: 4,velocityRange: [88,99]},
  'kick6': {note: 5,velocityRange: [88,99]},
  'kick7': {note: 6,velocityRange: [88,99]},

  'cymbal1': {note: 59,velocityRange: [66,77]},
  'cymbal2': {note: 53,velocityRange: [66,77]},
  'cymbal3': {note: 80,velocityRange: [66,77]},
  'cymbal4': {note: 81,velocityRange: [66,77]},

  'conga1': {note: 60,velocityRange: [66,77]},
  'conga2': {note: 61,velocityRange: [66,77]},
  'conga3': {note: 62,velocityRange: [66,77]},
  'conga4': {note: 63,velocityRange: [66,77]},
  'conga5': {note: 64,velocityRange: [66,77]},
};

/**
 * Generate drum pattern for a beat.
 * @param {string|string[]} drumNames - Drum name(s) or 'random'.
 * @param {number|number[]} beatOffsets - Offset(s) within the beat.
 * @param {number} [offsetJitter=rf(.1)] - Random offset jitter amount.
 * @param {number} [stutterChance=.3] - Probability of stutter effect.
 * @param {number[]} [stutterRange=[2,ri(1,11)]] - Range of stutter counts.
 * @param {number} [stutterDecayFactor=rf(.9,1.1)] - Velocity decay per stutter.
 * @returns {void}
 */
export const drummer = (
  drumNames: string | string[],
  beatOffsets?: number | number[],
  offsetJitter?: number,
  stutterChance?: number,
  stutterRange?: number[],
  stutterDecayFactor?: number
): void => {
  const g = globalThis as any;
  let actualBeatOffsets = beatOffsets ?? 0;
  const actualOffsetJitter = offsetJitter ?? g.rf(.1);
  const actualStutterChance = stutterChance ?? .3;
  const actualStutterRange = stutterRange ?? [2, g.m.round(g.rv(11, [2, 3], .3))];
  const actualDecayFactor = stutterDecayFactor ?? g.rf(.9, 1.1);

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] START', drumNames);

  if (drumNames === 'random') {
    const allDrums = Object.keys(drumMap);
    drumNames = [allDrums[g.m.floor(g.m.random() * allDrums.length)]];
    actualBeatOffsets = [0];
  }

  const drums = Array.isArray(drumNames) ? drumNames : drumNames.split(',').map(d => d.trim());
  const offsets: number[] = Array.isArray(actualBeatOffsets) ? [...actualBeatOffsets] : [actualBeatOffsets];

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] drums/offsets prepared');

  if (offsets.length < drums.length) {
    offsets.push(...new Array(drums.length - offsets.length).fill(0));
  } else if (offsets.length > drums.length) {
    offsets.length = drums.length;
  }

  const combined: Array<{ drum: string; offset: number }> = drums.map((drum, index) => ({ drum, offset: offsets[index] }));

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] combined prepared');

  if (g.rf() < .7) {
    if (g.rf() < .5) {
      combined.reverse();
    }
  } else {
    for (let i = combined.length - 1; i > 0; i--) {
      const j = g.m.floor(g.m.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
  }

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] randomization done');

  const adjustedOffsets = combined.map(({ offset }) => {
    if (g.rf() < .3) {
      return offset;
    } else {
      let adjusted = offset + (g.m.random() < 0.5 ? -actualOffsetJitter * g.rf(.5, 1) : actualOffsetJitter * g.rf(.5, 1));
      return adjusted - g.m.floor(adjusted);
    }
  });

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] offsets adjusted');

  combined.forEach(({ drum, offset }, idx) => {
    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log(`[drummer] processing drum ${idx}:`, drum);

    const drumInfo = drumMap[drum];
    if (drumInfo) {
      if (g.rf() < actualStutterChance) {
        if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] applying stutter');

        const numStutters = g.ri(...actualStutterRange);
        const stutterDuration = .25 * g.ri(1, 8) / numStutters;
        const [minVelocity, maxVelocity] = drumInfo.velocityRange;
        const isFadeIn = g.rf() < 0.7;

        for (let i = 0; i < numStutters; i++) {
          const tick = g.beatStart + (offset + i * stutterDuration) * g.tpBeat;
          let currentVelocity: number;

          if (isFadeIn) {
            const fadeInMultiplier = actualDecayFactor * (i / (numStutters * g.rf(0.4, 2.2) - 1));
            currentVelocity = g.clamp(g.m.min(maxVelocity, g.ri(33) + maxVelocity * fadeInMultiplier), 0, 127);
          } else {
            const fadeOutMultiplier = 1 - (actualDecayFactor * (i / (numStutters * g.rf(0.4, 2.2) - 1)));
            currentVelocity = g.clamp(g.m.max(0, g.ri(33) + maxVelocity * fadeOutMultiplier), 0, 127);
          }

          g.p(g.c, {tick: tick, type: 'on', vals: [g.drumCH, drumInfo.note, g.m.floor(currentVelocity)]});
        }
      } else {
        if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] no stutter');
        g.p(g.c, {tick: g.beatStart + offset * g.tpBeat, type: 'on', vals: [g.drumCH, drumInfo.note, g.ri(...drumInfo.velocityRange)]});
      }
    }

    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log(`[drummer] drum ${idx} done`);
  });

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[drummer] END');
};

/**
 * Play drums for primary meter (beat index 0-3 pattern).
 * @returns {void}
 */
export const playDrums = (): void => {
  if (beatIndex % 2 === 0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
    drummer(['kick1', 'kick3'], [0, .5]);
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
      drummer(['kick2', 'kick5'], [0, .5]);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
    drummer(['snare1', 'kick4', 'kick7', 'snare4'], [0, .5, .75, .25]);
  } else if (beatIndex % 2 === 0) {
    drummer('random');
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
      drummer(['snare5'], [0]);
    }
  } else {
    drummer(['snare6'], [0]);
  }
};

/**
 * Play drums for poly meter (different pattern from primary).
 * @returns {void}
 */
export const playDrums2 = (): void => {
  if (beatIndex % 2 === 0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
    drummer(['kick2', 'kick5', 'kick7'], [0, .5, .25]);
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
      drummer(['kick1', 'kick3', 'kick7'], [0, .5, .25]);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
    drummer(['snare2', 'kick6', 'snare3'], [0, .5, .75]);
  } else if (beatIndex % 2 === 0) {
    drummer(['snare7'], [0]);
    if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
      drummer(['snare7'], [0]);
    }
  } else {
    drummer('random');
  }
};

/**
 * Rhythm pattern configuration
 */
interface RhythmConfig {
  weights: number[];
  method: string;
  args: (length: number, pattern?: number[]) => any[];
}

/**
 * Rhythm patterns library with weighted selection.
 */
export const rhythms: { [key: string]: RhythmConfig } = {
  'binary': {weights: [2, 3, 1], method: 'binary', args: (length) => [length]},
  'hex': {weights: [2, 3, 1], method: 'hex', args: (length) => [length]},
  'onsets': {weights: [5, 0, 0], method: 'onsets', args: (length) => [{make: [length, () => [1, 2]]}]},
  'onsets2': {weights: [0, 2, 0], method: 'onsets', args: (length) => [{make: [length, [2, 3, 4]]}]},
  'onsets3': {weights: [0, 0, 7], method: 'onsets', args: (length) => [{make: [length, () => [3, 7]]}]},
  'random': {weights: [7, 0, 0], method: 'random', args: (length) => [length, rv(.97, [-.1, .3], .2)]},
  'random2': {weights: [0, 3, 0], method: 'random', args: (length) => [length, rv(.9, [-.3, .3], .3)]},
  'random3': {weights: [0, 0, 1], method: 'random', args: (length) => [length, rv(.6, [-.3, .3], .3)]},
  'euclid': {weights: [3, 3, 3], method: 'euclid', args: (length) => [length, closestDivisor(length, m.ceil(rf(2, length / rf(1, 1.2))))]},
  'rotate': {weights: [2, 2, 2], method: 'rotate', args: (length, pattern) => [pattern, ri(2), '?', length]},
  'morph': {weights: [2, 3, 3], method: 'morph', args: (length, pattern) => [pattern, '?', length]}
};

// @tonaljs/rhythm-pattern exports
const { binary: _binary, hex: _hex, onsets: _onsets, random: _random, probability: _probability, euclid: _euclid, rotate: _rotate } = RhythmPattern as any;

/**
 * Generate binary rhythm pattern.
 * @param {number} length - Target pattern length.
 * @returns {number[]} Binary rhythm pattern.
 */
export const binary = (length: number): number[] => {
  let pattern: number[] = [];
  while (pattern.length < length) { pattern = pattern.concat(_binary(ri(99))); }
  return patternLength(pattern, length);
};

/**
 * Generate hexadecimal rhythm pattern.
 * @param {number} length - Target pattern length.
 * @returns {number[]} Hex rhythm pattern.
 */
export const hex = (length: number): number[] => {
  let pattern: number[] = [];
  while (pattern.length < length) { pattern = pattern.concat(_hex(ri(99).toString(16))); }
  return patternLength(pattern, length);
};

/**
 * Generate onsets rhythm pattern.
 * @param {number|Object} numbers - Number or config object.
 * @returns {number[]} Onsets pattern.
 */
export const onsets = (numbers: number | any): number[] => {
  if (typeof numbers === 'object' && numbers.hasOwnProperty('make')) {
    const makeArray = numbers.make as [number, any];
    return makeOnsets(makeArray[0], makeArray[1]);
  }
  return _onsets(numbers);
};

/**
 * Generate random rhythm with probability.
 * @param {number} length - Pattern length.
 * @param {number} probOn - Probability of "on" (1) notes.
 * @returns {number[]} Random pattern.
 */
export const random = (length: number, probOn: number): number[] => {
  return _random(length, 1 - probOn);
};

/**
 * Generate probability-based rhythm.
 * @param {number[]} probs - Probability array.
 * @returns {number[]} Probability pattern.
 */
export const prob = (probs: number[]): number[] => {
  return _probability(probs);
};

/**
 * Generate Euclidean rhythm pattern.
 * @param {number} length - Pattern length.
 * @param {number} ones - Number of "on" beats.
 * @returns {number[]} Euclidean pattern.
 */
export const euclid = (length: number, ones: number): number[] => {
  return _euclid(length, ones);
};

/**
 * Rotate rhythm pattern.
 * @param {number[]} pattern - Pattern to rotate.
 * @param {number} rotations - Number of rotations.
 * @param {string} [direction='R'] - 'L' (left), 'R' (right), or '?' (random).
 * @param {number} [length=pattern.length] - Output length.
 * @returns {number[]} Rotated pattern.
 */
export const rotate = (pattern: number[], rotations: number, direction: string = "R", length: number = pattern.length): number[] => {
  if (direction === '?') { direction = rf() < .5 ? 'L' : 'R'; }
  if (direction.toUpperCase() === 'L') { rotations = (pattern.length - rotations) % pattern.length; }
  return patternLength(_rotate(pattern, rotations), length);
};

/**
 * Morph rhythm pattern by adjusting probabilities.
 * @param {number[]} pattern - Pattern to morph.
 * @param {string} [direction='both'] - 'up', 'down', 'both', or '?'.
 * @param {number} [length=pattern.length] - Output length.
 * @param {number} [probLow=.1] - Low probability bound.
 * @param {number} [probHigh] - High probability bound (defaults to probLow).
 * @returns {number[]} Morphed pattern.
 */
export const morph = (
  pattern: number[],
  direction: string = 'both',
  length: number = pattern.length,
  probLow: number = .1,
  probHigh?: number
): number[] => {
  probHigh = probHigh === undefined ? probLow : probHigh;
  let morpheus = pattern.map((v, index) => {
    let morph = probHigh === probLow ? rf(probLow) : rf(probLow, probHigh!);
    let _ = ['up', 'down', 'both'];
    let d = direction === '?' ? (_[ri(_.length - 1)]) : direction.toLowerCase();
    let up = v < 1 ? m.min(v + morph, 1) : v;
    let down = v > 0 ? m.max(v - morph, 0) : v;
    return (d === 'up' ? up : d === 'down' ? down : d === 'both' ? (v < 1 ? up : down) : v);
  });
  return prob(patternLength(morpheus, length));
};

/**
 * Set rhythm for a given level.
 * @param {string} level - 'beat', 'div', or 'subdiv'.
 * @returns {number[]} Rhythm pattern for the level.
 * @throws {Error} If invalid level provided.
 */
export const setRhythm = (level: string): number[] => {
  // Note: This function relies on global variables that should be declared in backstage.ts
  // The implementation references global state that needs to be properly scoped
  switch (level) {
    case 'beat': {
      const br = beatRhythm as number[] | number;
      const shouldRandom = typeof br === 'number' ? br < 1 : br.length < 1;
      const newRhythm = shouldRandom ? _random(numerator) : (getRhythm('beat', numerator, br as number[]) || _random(numerator));
      beatRhythm = newRhythm as number[];
      return beatRhythm;
    }
    case 'div': {
      const dr = divRhythm as number[] | number;
      const shouldRandom = typeof dr === 'number' ? dr < 1 : dr.length < 1;
      const newRhythm = shouldRandom ? _random(divsPerBeat, .4) : (getRhythm('div', divsPerBeat, dr as number[]) || _random(divsPerBeat, .4));
      divRhythm = newRhythm as number[];
      return divRhythm;
    }
    case 'subdiv': {
      const sr = subdivRhythm as number[] | number;
      const shouldRandom = typeof sr === 'number' ? sr < 1 : sr.length < 1;
      const newRhythm = shouldRandom ? _random(subdivsPerDiv, .3) : (getRhythm('subdiv', subdivsPerDiv, sr as number[]) || _random(subdivsPerDiv, .3));
      subdivRhythm = newRhythm as number[];
      return subdivRhythm;
    }
    case 'subsubdiv': {
      const ssr = subsubdivRhythm as number[] | number;
      const shouldRandom = typeof ssr === 'number' ? ssr < 1 : ssr.length < 1;
      const newRhythm = shouldRandom ? _random(subsubsPerSub, .3) : (getRhythm('subsubdiv', subsubsPerSub, ssr as number[]) || _random(subsubsPerSub, .3));
      subsubdivRhythm = newRhythm as number[];
      return subsubdivRhythm;
    }
    default:
      throw new Error('Invalid level provided to setRhythm');
  }
};

/**
 * Create custom onsets pattern.
 * @param {number} length - Target length.
 * @param {number|number[]|function} valuesOrRange - Onset values or range.
 * @returns {number[]} Onset pattern.
 */
export const makeOnsets = (length: number, valuesOrRange: number | number[] | (() => number[])): number[] => {
  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[makeOnsets] START', length, valuesOrRange);

  let onsets: number[] = [];
  let total = 0;
  let iterations = 0;

  while (total < length) {
    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log(`[makeOnsets] iteration ${iterations}, total=${total}`);

    let v = ra(valuesOrRange);
    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log(`[makeOnsets] v=${v}`);

    if (total + (v + 1) <= length) {
      onsets.push(v);
      total += v + 1;
      if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log(`[makeOnsets] added onset, new total=${total}`);
    } else if (Array.isArray(valuesOrRange) && valuesOrRange.length === 2) {
      v = valuesOrRange[0];
      if (total + (v + 1) <= length) {
        onsets.push(v);
        total += v + 1;
        if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log(`[makeOnsets] added onset, new total=${total}`);
      }
      if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[makeOnsets] breaking');
      break;
    } else {
      if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[makeOnsets] breaking');
      break;
    }

    iterations++;
    if (iterations > length * 10) {
      if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[makeOnsets] breaking');
      break;
    }
  }

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[makeOnsets] building rhythm array');

  let rhythm: number[] = [];
  for (let onset of onsets) {
    rhythm.push(1);
    for (let i = 0; i < onset; i++) { rhythm.push(0); }
  }
  while (rhythm.length < length) { rhythm.push(0); }

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[makeOnsets] END, length=', rhythm.length);

  return rhythm;
};

/**
 * Adjust pattern to desired length.
 * @param {number[]} pattern - Input pattern.
 * @param {number} [length] - Target length.
 * @returns {number[]} Pattern adjusted to length.
 */
export const patternLength = (pattern: number[], length?: number): number[] => {
  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[patternLength] START', pattern.length, length);

  if (length === undefined) {
    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[patternLength] END');
    return pattern;
  }

  if (pattern.length === 0) {
    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[patternLength] END');
    return pattern;  // Can't extend empty pattern
  }

  if (length > pattern.length) {
    while (pattern.length < length) {
      pattern = pattern.concat(pattern.slice(0, length - pattern.length));
    }
    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[patternLength] extended to', pattern.length);
  } else if (length < pattern.length) {
    pattern = pattern.slice(0, length);
    if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[patternLength] truncated to', pattern.length);
  }

  if ((globalThis.__POLYCHRON_TEST__ as any)?.enableLogging) console.log('[patternLength] END');

  return pattern;
};

/**
 * Find closest divisor to target value.
 * @param {number} x - Value to find divisor for.
 * @param {number} [target=2] - Target divisor value.
 * @returns {number} Closest divisor.
 */
export const closestDivisor = (x: number, target: number = 2): number => {
  let closest = Infinity;
  let smallestDiff = Infinity;

  for (let i = 1; i <= m.sqrt(x); i++) {
    if (x % i === 0) {
      [i, x / i].forEach(divisor => {
        if (divisor !== closest) {
          let diff = m.abs(divisor - target);
          if (diff < smallestDiff) {
            smallestDiff = diff;
            closest = divisor;
          }
        }
      });
    }
  }

  if (closest === Infinity) { return x; }
  return x % target === 0 ? target : closest;
};

// Rhythm methods lookup for getRhythm
const rhythmMethods: { [key: string]: Function } = {
  binary,
  hex,
  onsets,
  random,
  prob,
  euclid,
  rotate,
  morph
};

/**
 * Get rhythm using weighted selection or specific method.
 * @param {string} level - Rhythm level ('beat', 'div', 'subdiv').
 * @param {number} length - Pattern length.
 * @param {number[]} pattern - Current pattern.
 * @param {string} [method] - Specific rhythm method to use.
 * @param {...*} [args] - Arguments for the method.
 * @returns {number[]} Rhythm pattern.
 */
export const getRhythm = (level: string, length: number, pattern: number[], method?: string, ...args: any[]): number[] | null => {
  const levelIndex = ['beat', 'div', 'subdiv'].indexOf(level);

  const checkMethod = (m: string): any => {
    if (!rhythmMethods[m] || typeof rhythmMethods[m] !== 'function') {
      console.warn(`Unknown rhythm method: ${m}`);
      return null;
    }
    return rhythmMethods[m];
  };

  if (method) {
    const rhythmMethod = checkMethod(method);
    if (rhythmMethod) return rhythmMethod(...args);
  } else {
    const filteredRhythms = Object.fromEntries(
      Object.entries(rhythms).filter(([_, { weights }]) => weights[levelIndex] > 0)
    );
    const rhythmKey = randomWeightedSelection(filteredRhythms);
    if (rhythmKey && rhythms[rhythmKey]) {
      const { method: rhythmMethodKey, args: rhythmArgs } = rhythms[rhythmKey];
      const rhythmMethod = checkMethod(rhythmMethodKey);
      if (rhythmMethod) return rhythmMethod(...rhythmArgs(length, pattern));
    }
  }
  console.warn('unknown rhythm');
  return null;
};

/**
 * Track rhythm state (on/off) for a given unit level.
 * @param {string} unit - Rhythm unit ('beat', 'div', 'subdiv', 'subsubdiv').
 * @returns {void}
 */
export const trackRhythm = (unit: string): void => {
  const g = globalThis as any;
  const rhythmArray = g[`${unit}Rhythm`];
  const index = g[`${unit}Index`];
  const onKey = `${unit}sOn`;
  const offKey = `${unit}sOff`;

  if (rhythmArray[index] > 0) {
    g[onKey]++;
    g[offKey] = 0;
  } else {
    g[onKey] = 0;
    g[offKey]++;
  }
};

// Initialize test framework object
if (!(globalThis as any).__POLYCHRON_TEST__) {
  (globalThis as any).__POLYCHRON_TEST__ = { enableLogging: false };
}

// Expose to globalThis for backward compatibility
(globalThis as any).drummer = drummer;
(globalThis as any).patternLength = patternLength;
(globalThis as any).drumMap = drumMap;
(globalThis as any).playDrums = playDrums;
(globalThis as any).trackRhythm = trackRhythm;
