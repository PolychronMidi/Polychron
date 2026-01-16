"use strict";
// rhythm.ts - Rhythmic pattern generation with drum mapping and stutter effects.
// minimalist comments, details at: rhythm.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackSubsubdivRhythm = exports.trackSubdivRhythm = exports.trackDivRhythm = exports.trackBeatRhythm = exports.getRhythm = exports.closestDivisor = exports.patternLength = exports.makeOnsets = exports.setRhythm = exports.morph = exports.rotate = exports.euclid = exports.prob = exports.random = exports.onsets = exports.hex = exports.binary = exports.rhythms = exports.playDrums2 = exports.playDrums = exports.drummer = exports.drumMap = void 0;
/**
 * Drum sound mapping with MIDI notes and velocities
 */
exports.drumMap = {
    'snare1': { note: 31, velocityRange: [99, 111] },
    'snare2': { note: 33, velocityRange: [99, 111] },
    'snare3': { note: 124, velocityRange: [77, 88] },
    'snare4': { note: 125, velocityRange: [77, 88] },
    'snare5': { note: 75, velocityRange: [77, 88] },
    'snare6': { note: 85, velocityRange: [77, 88] },
    'snare7': { note: 118, velocityRange: [66, 77] },
    'snare8': { note: 41, velocityRange: [66, 77] },
    'kick1': { note: 12, velocityRange: [111, 127] },
    'kick2': { note: 14, velocityRange: [111, 127] },
    'kick3': { note: 0, velocityRange: [99, 111] },
    'kick4': { note: 2, velocityRange: [99, 111] },
    'kick5': { note: 4, velocityRange: [88, 99] },
    'kick6': { note: 5, velocityRange: [88, 99] },
    'kick7': { note: 6, velocityRange: [88, 99] },
    'cymbal1': { note: 59, velocityRange: [66, 77] },
    'cymbal2': { note: 53, velocityRange: [66, 77] },
    'cymbal3': { note: 80, velocityRange: [66, 77] },
    'cymbal4': { note: 81, velocityRange: [66, 77] },
    'conga1': { note: 60, velocityRange: [66, 77] },
    'conga2': { note: 61, velocityRange: [66, 77] },
    'conga3': { note: 62, velocityRange: [66, 77] },
    'conga4': { note: 63, velocityRange: [66, 77] },
    'conga5': { note: 64, velocityRange: [66, 77] },
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
const drummer = (drumNames, beatOffsets, offsetJitter, stutterChance, stutterRange, stutterDecayFactor) => {
    const g = globalThis;
    let actualBeatOffsets = beatOffsets ?? 0;
    const actualOffsetJitter = offsetJitter ?? g.rf(.1);
    const actualStutterChance = stutterChance ?? .3;
    const actualStutterRange = stutterRange ?? [2, g.m.round(g.rv(11, [2, 3], .3))];
    const actualDecayFactor = stutterDecayFactor ?? g.rf(.9, 1.1);
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[drummer] START', drumNames);
    if (drumNames === 'random') {
        const allDrums = Object.keys(exports.drumMap);
        drumNames = [allDrums[g.m.floor(g.m.random() * allDrums.length)]];
        actualBeatOffsets = [0];
    }
    const drums = Array.isArray(drumNames) ? drumNames : drumNames.split(',').map(d => d.trim());
    const offsets = Array.isArray(actualBeatOffsets) ? [...actualBeatOffsets] : [actualBeatOffsets];
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[drummer] drums/offsets prepared');
    if (offsets.length < drums.length) {
        offsets.push(...new Array(drums.length - offsets.length).fill(0));
    }
    else if (offsets.length > drums.length) {
        offsets.length = drums.length;
    }
    const combined = drums.map((drum, index) => ({ drum, offset: offsets[index] }));
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[drummer] combined prepared');
    if (g.rf() < .7) {
        if (g.rf() < .5) {
            combined.reverse();
        }
    }
    else {
        for (let i = combined.length - 1; i > 0; i--) {
            const j = g.m.floor(g.m.random() * (i + 1));
            [combined[i], combined[j]] = [combined[j], combined[i]];
        }
    }
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[drummer] randomization done');
    const adjustedOffsets = combined.map(({ offset }) => {
        if (g.rf() < .3) {
            return offset;
        }
        else {
            let adjusted = offset + (g.m.random() < 0.5 ? -actualOffsetJitter * g.rf(.5, 1) : actualOffsetJitter * g.rf(.5, 1));
            return adjusted - g.m.floor(adjusted);
        }
    });
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[drummer] offsets adjusted');
    combined.forEach(({ drum, offset }, idx) => {
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log(`[drummer] processing drum ${idx}:`, drum);
        const drumInfo = exports.drumMap[drum];
        if (drumInfo) {
            if (g.rf() < actualStutterChance) {
                if (globalThis.__POLYCHRON_TEST__?.enableLogging)
                    console.log('[drummer] applying stutter');
                const numStutters = g.ri(...actualStutterRange);
                const stutterDuration = .25 * g.ri(1, 8) / numStutters;
                const [minVelocity, maxVelocity] = drumInfo.velocityRange;
                const isFadeIn = g.rf() < 0.7;
                for (let i = 0; i < numStutters; i++) {
                    const tick = g.beatStart + (offset + i * stutterDuration) * g.tpBeat;
                    let currentVelocity;
                    if (isFadeIn) {
                        const fadeInMultiplier = actualDecayFactor * (i / (numStutters * g.rf(0.4, 2.2) - 1));
                        currentVelocity = g.clamp(g.m.min(maxVelocity, g.ri(33) + maxVelocity * fadeInMultiplier), 0, 127);
                    }
                    else {
                        const fadeOutMultiplier = 1 - (actualDecayFactor * (i / (numStutters * g.rf(0.4, 2.2) - 1)));
                        currentVelocity = g.clamp(g.m.max(0, g.ri(33) + maxVelocity * fadeOutMultiplier), 0, 127);
                    }
                    g.p(g.c, { tick: tick, type: 'on', vals: [g.drumCH, drumInfo.note, g.m.floor(currentVelocity)] });
                }
            }
            else {
                if (globalThis.__POLYCHRON_TEST__?.enableLogging)
                    console.log('[drummer] no stutter');
                g.p(g.c, { tick: g.beatStart + offset * g.tpBeat, type: 'on', vals: [g.drumCH, drumInfo.note, g.ri(...drumInfo.velocityRange)] });
            }
        }
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log(`[drummer] drum ${idx} done`);
    });
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[drummer] END');
};
exports.drummer = drummer;
/**
 * Play drums for primary meter (beat index 0-3 pattern).
 * @returns {void}
 */
const playDrums = () => {
    if (beatIndex % 2 === 0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
        (0, exports.drummer)(['kick1', 'kick3'], [0, .5]);
        if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
            (0, exports.drummer)(['kick2', 'kick5'], [0, .5]);
        }
    }
    else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
        (0, exports.drummer)(['snare1', 'kick4', 'kick7', 'snare4'], [0, .5, .75, .25]);
    }
    else if (beatIndex % 2 === 0) {
        (0, exports.drummer)('random');
        if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
            (0, exports.drummer)(['snare5'], [0]);
        }
    }
    else {
        (0, exports.drummer)(['snare6'], [0]);
    }
};
exports.playDrums = playDrums;
/**
 * Play drums for poly meter (different pattern from primary).
 * @returns {void}
 */
const playDrums2 = () => {
    if (beatIndex % 2 === 0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
        (0, exports.drummer)(['kick2', 'kick5', 'kick7'], [0, .5, .25]);
        if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
            (0, exports.drummer)(['kick1', 'kick3', 'kick7'], [0, .5, .25]);
        }
    }
    else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1, beatsOff * rf(2, 3.5)) * bpmRatio3) {
        (0, exports.drummer)(['snare2', 'kick6', 'snare3'], [0, .5, .75]);
    }
    else if (beatIndex % 2 === 0) {
        (0, exports.drummer)(['snare7'], [0]);
        if (numerator % 2 === 1 && beatIndex === numerator - 1 && rf() < (1 / measuresPerPhrase) * bpmRatio3) {
            (0, exports.drummer)(['snare7'], [0]);
        }
    }
    else {
        (0, exports.drummer)('random');
    }
};
exports.playDrums2 = playDrums2;
/**
 * Rhythm patterns library with weighted selection.
 */
exports.rhythms = {
    'binary': { weights: [2, 3, 1], method: 'binary', args: (length) => [length] },
    'hex': { weights: [2, 3, 1], method: 'hex', args: (length) => [length] },
    'onsets': { weights: [5, 0, 0], method: 'onsets', args: (length) => [{ make: [length, () => [1, 2]] }] },
    'onsets2': { weights: [0, 2, 0], method: 'onsets', args: (length) => [{ make: [length, [2, 3, 4]] }] },
    'onsets3': { weights: [0, 0, 7], method: 'onsets', args: (length) => [{ make: [length, () => [3, 7]] }] },
    'random': { weights: [7, 0, 0], method: 'random', args: (length) => [length, rv(.97, [-.1, .3], .2)] },
    'random2': { weights: [0, 3, 0], method: 'random', args: (length) => [length, rv(.9, [-.3, .3], .3)] },
    'random3': { weights: [0, 0, 1], method: 'random', args: (length) => [length, rv(.6, [-.3, .3], .3)] },
    'euclid': { weights: [3, 3, 3], method: 'euclid', args: (length) => [length, (0, exports.closestDivisor)(length, m.ceil(rf(2, length / rf(1, 1.2))))] },
    'rotate': { weights: [2, 2, 2], method: 'rotate', args: (length, pattern) => [pattern, ri(2), '?', length] },
    'morph': { weights: [2, 3, 3], method: 'morph', args: (length, pattern) => [pattern, '?', length] }
};
// @tonaljs/rhythm-pattern exports
const { binary: _binary, hex: _hex, onsets: _onsets, random: _random, probability: _probability, euclid: _euclid, rotate: _rotate } = require('@tonaljs/rhythm-pattern');
/**
 * Generate binary rhythm pattern.
 * @param {number} length - Target pattern length.
 * @returns {number[]} Binary rhythm pattern.
 */
const binary = (length) => {
    let pattern = [];
    while (pattern.length < length) {
        pattern = pattern.concat(_binary(ri(99)));
    }
    return (0, exports.patternLength)(pattern, length);
};
exports.binary = binary;
/**
 * Generate hexadecimal rhythm pattern.
 * @param {number} length - Target pattern length.
 * @returns {number[]} Hex rhythm pattern.
 */
const hex = (length) => {
    let pattern = [];
    while (pattern.length < length) {
        pattern = pattern.concat(_hex(ri(99).toString(16)));
    }
    return (0, exports.patternLength)(pattern, length);
};
exports.hex = hex;
/**
 * Generate onsets rhythm pattern.
 * @param {number|Object} numbers - Number or config object.
 * @returns {number[]} Onsets pattern.
 */
const onsets = (numbers) => {
    if (typeof numbers === 'object' && numbers.hasOwnProperty('make')) {
        const makeArray = numbers.make;
        return (0, exports.makeOnsets)(makeArray[0], makeArray[1]);
    }
    return _onsets(numbers);
};
exports.onsets = onsets;
/**
 * Generate random rhythm with probability.
 * @param {number} length - Pattern length.
 * @param {number} probOn - Probability of "on" (1) notes.
 * @returns {number[]} Random pattern.
 */
const random = (length, probOn) => {
    return _random(length, 1 - probOn);
};
exports.random = random;
/**
 * Generate probability-based rhythm.
 * @param {number[]} probs - Probability array.
 * @returns {number[]} Probability pattern.
 */
const prob = (probs) => {
    return _probability(probs);
};
exports.prob = prob;
/**
 * Generate Euclidean rhythm pattern.
 * @param {number} length - Pattern length.
 * @param {number} ones - Number of "on" beats.
 * @returns {number[]} Euclidean pattern.
 */
const euclid = (length, ones) => {
    return _euclid(length, ones);
};
exports.euclid = euclid;
/**
 * Rotate rhythm pattern.
 * @param {number[]} pattern - Pattern to rotate.
 * @param {number} rotations - Number of rotations.
 * @param {string} [direction='R'] - 'L' (left), 'R' (right), or '?' (random).
 * @param {number} [length=pattern.length] - Output length.
 * @returns {number[]} Rotated pattern.
 */
const rotate = (pattern, rotations, direction = "R", length = pattern.length) => {
    if (direction === '?') {
        direction = rf() < .5 ? 'L' : 'R';
    }
    if (direction.toUpperCase() === 'L') {
        rotations = (pattern.length - rotations) % pattern.length;
    }
    return (0, exports.patternLength)(_rotate(pattern, rotations), length);
};
exports.rotate = rotate;
/**
 * Morph rhythm pattern by adjusting probabilities.
 * @param {number[]} pattern - Pattern to morph.
 * @param {string} [direction='both'] - 'up', 'down', 'both', or '?'.
 * @param {number} [length=pattern.length] - Output length.
 * @param {number} [probLow=.1] - Low probability bound.
 * @param {number} [probHigh] - High probability bound (defaults to probLow).
 * @returns {number[]} Morphed pattern.
 */
const morph = (pattern, direction = 'both', length = pattern.length, probLow = .1, probHigh) => {
    probHigh = probHigh === undefined ? probLow : probHigh;
    let morpheus = pattern.map((v, index) => {
        let morph = probHigh === probLow ? rf(probLow) : rf(probLow, probHigh);
        let _ = ['up', 'down', 'both'];
        let d = direction === '?' ? (_[ri(_.length - 1)]) : direction.toLowerCase();
        let up = v < 1 ? m.min(v + morph, 1) : v;
        let down = v > 0 ? m.max(v - morph, 0) : v;
        return (d === 'up' ? up : d === 'down' ? down : d === 'both' ? (v < 1 ? up : down) : v);
    });
    return (0, exports.prob)((0, exports.patternLength)(morpheus, length));
};
exports.morph = morph;
/**
 * Set rhythm for a given level.
 * @param {string} level - 'beat', 'div', or 'subdiv'.
 * @returns {number[]} Rhythm pattern for the level.
 * @throws {Error} If invalid level provided.
 */
const setRhythm = (level) => {
    // Note: This function relies on global variables that should be declared in backstage.ts
    // The implementation references global state that needs to be properly scoped
    switch (level) {
        case 'beat': {
            const br = beatRhythm;
            const shouldRandom = typeof br === 'number' ? br < 1 : br.length < 1;
            const newRhythm = shouldRandom ? _random(numerator) : (0, exports.getRhythm)('beat', numerator, br);
            beatRhythm = newRhythm;
            return beatRhythm;
        }
        case 'div': {
            const dr = divRhythm;
            const shouldRandom = typeof dr === 'number' ? dr < 1 : dr.length < 1;
            const newRhythm = shouldRandom ? _random(divsPerBeat, .4) : (0, exports.getRhythm)('div', divsPerBeat, dr);
            divRhythm = newRhythm;
            return divRhythm;
        }
        case 'subdiv': {
            const sr = subdivRhythm;
            const shouldRandom = typeof sr === 'number' ? sr < 1 : sr.length < 1;
            const newRhythm = shouldRandom ? _random(subdivsPerDiv, .3) : (0, exports.getRhythm)('subdiv', subdivsPerDiv, sr);
            subdivRhythm = newRhythm;
            return subdivRhythm;
        }
        case 'subsubdiv': {
            const ssr = subsubdivRhythm;
            const shouldRandom = typeof ssr === 'number' ? ssr < 1 : ssr.length < 1;
            const newRhythm = shouldRandom ? _random(subsubsPerSub, .3) : (0, exports.getRhythm)('subsubdiv', subsubsPerSub, ssr);
            subsubdivRhythm = newRhythm;
            return subsubdivRhythm;
        }
        default:
            throw new Error('Invalid level provided to setRhythm');
    }
};
exports.setRhythm = setRhythm;
/**
 * Create custom onsets pattern.
 * @param {number} length - Target length.
 * @param {number|number[]|function} valuesOrRange - Onset values or range.
 * @returns {number[]} Onset pattern.
 */
const makeOnsets = (length, valuesOrRange) => {
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[makeOnsets] START', length, valuesOrRange);
    let onsets = [];
    let total = 0;
    let iterations = 0;
    while (total < length) {
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log(`[makeOnsets] iteration ${iterations}, total=${total}`);
        let v = ra(valuesOrRange);
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log(`[makeOnsets] v=${v}`);
        if (total + (v + 1) <= length) {
            onsets.push(v);
            total += v + 1;
            if (globalThis.__POLYCHRON_TEST__?.enableLogging)
                console.log(`[makeOnsets] added onset, new total=${total}`);
        }
        else if (Array.isArray(valuesOrRange) && valuesOrRange.length === 2) {
            v = valuesOrRange[0];
            if (total + (v + 1) <= length) {
                onsets.push(v);
                total += v + 1;
                if (globalThis.__POLYCHRON_TEST__?.enableLogging)
                    console.log(`[makeOnsets] added onset, new total=${total}`);
            }
            if (globalThis.__POLYCHRON_TEST__?.enableLogging)
                console.log('[makeOnsets] breaking');
            break;
        }
        else {
            if (globalThis.__POLYCHRON_TEST__?.enableLogging)
                console.log('[makeOnsets] breaking');
            break;
        }
        iterations++;
        if (iterations > length * 10) {
            if (globalThis.__POLYCHRON_TEST__?.enableLogging)
                console.log('[makeOnsets] breaking');
            break;
        }
    }
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[makeOnsets] building rhythm array');
    let rhythm = [];
    for (let onset of onsets) {
        rhythm.push(1);
        for (let i = 0; i < onset; i++) {
            rhythm.push(0);
        }
    }
    while (rhythm.length < length) {
        rhythm.push(0);
    }
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[makeOnsets] END, length=', rhythm.length);
    return rhythm;
};
exports.makeOnsets = makeOnsets;
/**
 * Adjust pattern to desired length.
 * @param {number[]} pattern - Input pattern.
 * @param {number} [length] - Target length.
 * @returns {number[]} Pattern adjusted to length.
 */
const patternLength = (pattern, length) => {
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[patternLength] START', pattern.length, length);
    if (length === undefined) {
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log('[patternLength] END');
        return pattern;
    }
    if (pattern.length === 0) {
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log('[patternLength] END');
        return pattern; // Can't extend empty pattern
    }
    if (length > pattern.length) {
        while (pattern.length < length) {
            pattern = pattern.concat(pattern.slice(0, length - pattern.length));
        }
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log('[patternLength] extended to', pattern.length);
    }
    else if (length < pattern.length) {
        pattern = pattern.slice(0, length);
        if (globalThis.__POLYCHRON_TEST__?.enableLogging)
            console.log('[patternLength] truncated to', pattern.length);
    }
    if (globalThis.__POLYCHRON_TEST__?.enableLogging)
        console.log('[patternLength] END');
    return pattern;
};
exports.patternLength = patternLength;
/**
 * Find closest divisor to target value.
 * @param {number} x - Value to find divisor for.
 * @param {number} [target=2] - Target divisor value.
 * @returns {number} Closest divisor.
 */
const closestDivisor = (x, target = 2) => {
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
    if (closest === Infinity) {
        return x;
    }
    return x % target === 0 ? target : closest;
};
exports.closestDivisor = closestDivisor;
/**
 * Get rhythm using weighted selection or specific method.
 * @param {string} level - Rhythm level ('beat', 'div', 'subdiv').
 * @param {number} length - Pattern length.
 * @param {number[]} pattern - Current pattern.
 * @param {string} [method] - Specific rhythm method to use.
 * @param {...*} [args] - Arguments for the method.
 * @returns {number[]} Rhythm pattern.
 */
const getRhythm = (level, length, pattern, method, ...args) => {
    const levelIndex = ['beat', 'div', 'subdiv'].indexOf(level);
    const checkMethod = (m) => {
        if (!global[m] || typeof global[m] !== 'function') {
            console.warn(`Unknown rhythm method: ${m}`);
            return null;
        }
        return global[m];
    };
    if (method) {
        const rhythmMethod = checkMethod(method);
        if (rhythmMethod)
            return rhythmMethod(...args);
    }
    else {
        const filteredRhythms = Object.fromEntries(Object.entries(exports.rhythms).filter(([_, { weights }]) => weights[levelIndex] > 0));
        const rhythmKey = randomWeightedSelection(filteredRhythms);
        if (rhythmKey && exports.rhythms[rhythmKey]) {
            const { method: rhythmMethodKey, args: rhythmArgs } = exports.rhythms[rhythmKey];
            const rhythmMethod = checkMethod(rhythmMethodKey);
            if (rhythmMethod)
                return rhythmMethod(...rhythmArgs(length, pattern));
        }
    }
    console.warn('unknown rhythm');
    return null;
};
exports.getRhythm = getRhythm;
/**
 * Track beat rhythm state (on/off).
 * @returns {void}
 */
const trackBeatRhythm = () => {
    if (beatRhythm[beatIndex] > 0) {
        beatsOn++;
        beatsOff = 0;
    }
    else {
        beatsOn = 0;
        beatsOff++;
    }
};
exports.trackBeatRhythm = trackBeatRhythm;
/**
 * Track division rhythm state (on/off).
 * @returns {void}
 */
const trackDivRhythm = () => {
    if (divRhythm[divIndex] > 0) {
        divsOn++;
        divsOff = 0;
    }
    else {
        divsOn = 0;
        divsOff++;
    }
};
exports.trackDivRhythm = trackDivRhythm;
/**
 * Track subdivision rhythm state (on/off).
 * @returns {void}
 */
const trackSubdivRhythm = () => {
    if (subdivRhythm[subdivIndex] > 0) {
        subdivsOn++;
        subdivsOff = 0;
    }
    else {
        subdivsOn = 0;
        subdivsOff++;
    }
};
exports.trackSubdivRhythm = trackSubdivRhythm;
/**
 * Track sub-subdivision rhythm state (on/off).
 * @returns {void}
 */
const trackSubsubdivRhythm = () => {
    if (subsubdivRhythm[subsubdivIndex] > 0) {
        subsubdivsOn++;
        subsubdivsOff = 0;
    }
    else {
        subsubdivsOn = 0;
        subsubdivsOff++;
    }
};
exports.trackSubsubdivRhythm = trackSubsubdivRhythm;
// Export all functions to globalThis for backward compatibility
globalThis.drumMap = exports.drumMap;
globalThis.drummer = exports.drummer;
globalThis.playDrums = exports.playDrums;
globalThis.playDrums2 = exports.playDrums2;
globalThis.binary = exports.binary;
globalThis.hex = exports.hex;
globalThis.onsets = exports.onsets;
globalThis.random = exports.random;
globalThis.prob = exports.prob;
globalThis.euclid = exports.euclid;
globalThis.rotate = exports.rotate;
globalThis.morph = exports.morph;
globalThis.setRhythm = exports.setRhythm;
globalThis.makeOnsets = exports.makeOnsets;
globalThis.patternLength = exports.patternLength;
globalThis.closestDivisor = exports.closestDivisor;
globalThis.getRhythm = exports.getRhythm;
globalThis.trackBeatRhythm = exports.trackBeatRhythm;
globalThis.trackDivRhythm = exports.trackDivRhythm;
globalThis.trackSubdivRhythm = exports.trackSubdivRhythm;
globalThis.trackSubsubdivRhythm = exports.trackSubsubdivRhythm;
// Export to globalThis test namespace for clean test access
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    Object.assign(globalThis.__POLYCHRON_TEST__, {
        drummer: exports.drummer, patternLength: exports.patternLength, makeOnsets: exports.makeOnsets, closestDivisor: exports.closestDivisor, drumMap: exports.drumMap
    });
}
//# sourceMappingURL=rhythm.js.map
