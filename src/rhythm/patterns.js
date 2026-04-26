// src/rhythm/patterns.js - pattern utilities and rhythm methods

// Local default pattern table

moduleLifecycle.declare({
  name: 'patterns-variant',
  subsystem: 'rhythm',
  deps: ['rhythmRegistry'],
  provides: ['patterns-variant'],
  init: () => {
    const LOCAL_RHYTHMS = {
      'binary':{weights:[2,3,1],method:'binary',args:(length)=>[length]},
      'hex':{weights:[2,3,1],method:'hex',args:(length)=>[length]},
      'onsets':{weights:[5,0,0],method:'onsets',args:(length)=>[{make:[length,()=>[1,2]]}]},
      'onsets2':{weights:[0,2,0],method:'onsets',args:(length)=>[{make:[length,[2,3,4]]}]},
      'onsets3':{weights:[0,0,7],method:'onsets',args:(length)=>[{make:[length,()=>[3,7]]}]},
      'random':{weights:[7,0,0],method:'random',args:(length)=>[length,rv(.97,[-.1,.3],.2)]},
      'random2':{weights:[0,3,0],method:'random',args:(length)=>[length,rv(.9,[-.3,.3],.3)]},
      'random3':{weights:[0,0,1],method:'random',args:(length)=>[length,rv(.6,[-.3,.3],.3)]},
      'euclid':{weights:[3,3,3],method:'euclid',args:(length)=>[length,closestDivisor(length,m.ceil(rf(2,length / rf(1,1.2))))]},
      'rotate':{weights:[2,2,2],method:'rotate',args:(length,pattern)=>[pattern,ri(2),'?',length]},
      'morph':{weights:[2,3,3],method:'morph',args:(length,pattern)=>[pattern,'?',length]}
    };

    // Populate the naked-global `rhythms` by mutating rather than conditionally reassigning it
    rhythms = {};
    Object.assign(rhythms, LOCAL_RHYTHMS);
    if (RHYTHM_PATTERNS) {
      Object.assign(rhythms, RHYTHM_PATTERNS);
    }

    // bootstrap global rp contains the required rhythm-pattern module
    _rp = require('@tonaljs/rhythm-pattern');
    _binary = _rp.binary; _hex = _rp.hex; _onsets = _rp.onsets; _random = _rp.random; _probability = _rp.probability; _euclid = _rp.euclid; _rotate = _rp.rotate;


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
      const morpheus = pattern.map(v => {
        const morphv = probHigh === probLow ? rf(probLow) : rf(probLow, probHigh);
        const _ = ['up', 'down', 'both']; const d = direction === '?' ? (_[ri(_.length - 1)]) : direction.toLowerCase();
        const up = v < 1 ? m.min(v + morphv, 1) : v; const down = v > 0 ? m.max(v - morphv, 0) : v;
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
            if (divisor !== closest) { const diff = m.abs(divisor - target);
              if (diff < smallestDiff) { smallestDiff = diff; closest = divisor; }
            }
          });
        }
      }
      if (closest === Infinity) { return x; }
      return x % target === 0 ? target : closest;
    };

    // Register existing generator methods into the rhythmRegistry (fail-fast)
    rhythmRegistry.register('binary', binary);
    rhythmRegistry.register('hex', hex);
    rhythmRegistry.register('onsets', onsets);
    rhythmRegistry.register('random', random);
    rhythmRegistry.register('prob', prob);
    rhythmRegistry.register('euclid', euclid);
    rhythmRegistry.register('rotate', rotate);
    rhythmRegistry.register('morph', morph);
    rhythmRegistry.register('closestDivisor', closestDivisor);
    return { registered: true };
  },
});
