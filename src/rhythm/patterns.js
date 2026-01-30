// src/rhythm/patterns.js - pattern utilities moved from src/rhythm.js
const { binary: _binary, hex: _hex, onsets: _onsets, random: _random, probability: _probability, euclid: _euclid, rotate: _rotate } = require('@tonaljs/rhythm-pattern');

binary = (length) => { let pattern = [];
  while (pattern.length < length) { pattern = pattern.concat(_binary(ri(99))); }
  return patternLength(pattern, length);
};

hex = (length) => { let pattern = [];
  while (pattern.length < length) { pattern = pattern.concat(_hex(ri(99).toString(16))); }
  return patternLength(pattern, length);
};

onsets = (numbers) => {
  if (typeof numbers === 'object' && numbers.hasOwnProperty('make')) {
    return makeOnsets(...numbers.make);
  }
  return _onsets(numbers);
};

random = (length, probOn) => { return _random(length, 1 - probOn); };

prob = (probs) => { return _probability(probs); };

euclid = (length, ones) => { return _euclid(length, ones); };

rotate = (pattern, rotations, direction = "R", length = pattern.length) => {
  if (direction === '?') { direction = rf() < .5 ? 'L' : 'R'; }
  if (direction.toUpperCase() === 'L') { rotations = (pattern.length - rotations) % pattern.length; }
  return patternLength(_rotate(pattern, rotations), length);
};

morph = (pattern, direction = 'both', length = pattern.length, probLow = .1, probHigh) => {
  probHigh = probHigh === undefined ? probLow : probHigh;
  let morpheus = pattern.map((v, index) => {
    let morphv = probHigh === probLow ? rf(probLow) : rf(probLow, probHigh);
    let _ = ['up', 'down', 'both']; let d = direction === '?' ? (_[ri(_.length - 1)]) : direction.toLowerCase();
    let up = v < 1 ? m.min(v + morphv, 1) : v; let down = v > 0 ? m.max(v - morphv, 0) : v;
    return (d === 'up' ? up : d === 'down' ? down : d === 'both' ? (v < 1 ? up : down) : v);
  });
  return prob(patternLength(morpheus, length));
};

closestDivisor = (x, target = 2) => {
  let closest = Infinity;
  let smallestDiff = Infinity;
  for (let i = 1; i <= m.sqrt(x); i++) {
    if (x % i === 0) {
      [i, x / i].forEach(divisor => {
        if (divisor !== closest) { let diff = m.abs(divisor - target);
          if (diff < smallestDiff) { smallestDiff = diff; closest = divisor; }
        }
      });
    }
  }
  if (closest === Infinity) { return x; }
  return x % target === 0 ? target : closest;
};

module.exports = { binary, hex, onsets, random, prob, euclid, rotate, morph, closestDivisor };
