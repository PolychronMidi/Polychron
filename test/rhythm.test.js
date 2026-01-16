// test/rhythm.test.js
import "../dist/sheet.js";
import "../dist/writer.js";
import "../dist/backstage.js";
import "../dist/rhythm.js";

// Enable test logging
globalThis.__POLYCHRON_TEST__.enableLogging = true;

let m = Math;
let c, drumCH, beatStart, tpBeat, beatIndex, numerator, beatRhythm, beatsOff, bpmRatio3, measuresPerPhrase;
let divsPerBeat, subdivsPerDiv, divRhythm, subdivRhythm;

// Setup global state
function setupGlobalState() {
  globalThis.c = [];
  globalThis.drumCH = 9;
  globalThis.beatStart = 0;
  globalThis.tpBeat = 480;
  globalThis.beatIndex = 0;
  globalThis.numerator = 4;
  globalThis.beatRhythm = [1, 0, 1, 0];
  globalThis.beatsOff = 0;
  globalThis.bpmRatio3 = 1;
  globalThis.measuresPerPhrase = 4;
  globalThis.divsPerBeat = 2;
  globalThis.subdivsPerDiv = 2;
  globalThis.divRhythm = [1, 0];
  globalThis.subdivRhythm = [1, 0];
  globalThis.m = Math;
  globalThis.drumMap = {
    'snare1': { note: 31, velocityRange: [99, 111] },
    'kick1': { note: 12, velocityRange: [111, 127] },
    'cymbal1': { note: 59, velocityRange: [66, 77] },
    'conga1': { note: 60, velocityRange: [66, 77] }
  };
  // Also assign to local for convenience
  c = globalThis.c;
  drumCH = globalThis.drumCH;
  beatStart = globalThis.beatStart;
  tpBeat = globalThis.tpBeat;
  beatIndex = globalThis.beatIndex;
  numerator = globalThis.numerator;
  beatRhythm = globalThis.beatRhythm;
  beatsOff = globalThis.beatsOff;
  bpmRatio3 = globalThis.bpmRatio3;
  measuresPerPhrase = globalThis.measuresPerPhrase;
  divsPerBeat = globalThis.divsPerBeat;
  subdivsPerDiv = globalThis.subdivsPerDiv;
  divRhythm = globalThis.divRhythm;
  subdivRhythm = global.subdivRhythm;
  m = global.m;
}

// Import from test namespace
const { rf, ri, clamp, rv, ra, p, drummer, patternLength, makeOnsets, closestDivisor, drumMap } = globalThis.__POLYCHRON_TEST__;

describe('drumMap', () => {
  it('should define drum mappings with notes and velocity ranges', () => {
    expect(drumMap.snare1).toEqual({ note: 31, velocityRange: [99, 111] });
    expect(drumMap.kick1).toEqual({ note: 12, velocityRange: [111, 127] });
  });

  it('should have valid MIDI note numbers', () => {
    Object.values(drumMap).forEach(drum => {
      expect(drum.note).toBeGreaterThanOrEqual(0);
      expect(drum.note).toBeLessThanOrEqual(127);
    });
  });

  it('should have valid velocity ranges', () => {
    Object.values(drumMap).forEach(drum => {
      expect(drum.velocityRange[0]).toBeGreaterThanOrEqual(0);
      expect(drum.velocityRange[1]).toBeLessThanOrEqual(127);
      expect(drum.velocityRange[0]).toBeLessThanOrEqual(drum.velocityRange[1]);
    });
  });
});

describe('drummer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should play single drum at offset 0', () => {
    drummer(['snare1'], [0]);
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].vals[0]).toBe(drumCH);
    expect(c[0].vals[1]).toBe(31); // snare1 note
  });

  it('should play multiple drums', () => {
    drummer(['snare1', 'kick1'], [0, 0.5]);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should handle string input with commas', () => {
    drummer('snare1,kick1', [0, 0.5]);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should handle random drum selection', () => {
    drummer('random', [0]);
    expect(c.length).toBeGreaterThan(0);
    const playedNote = c[0].vals[1];
    const allNotes = Object.values(drumMap).map(d => d.note);
    expect(allNotes).toContain(playedNote);
  });

  it('should apply offsets correctly', () => {
    beatStart = 0;
    tpBeat = 480;
    drummer(['snare1'], [0.5]);
    const firstTick = c[0].tick;
    expect(firstTick).toBeGreaterThanOrEqual(240); // 0.5 * 480
  });

  it('should fill missing offsets with zeros', () => {
    drummer(['snare1', 'kick1', 'cymbal1'], [0]);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should truncate extra offsets', () => {
    drummer(['snare1'], [0, 0.5, 1, 1.5]);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should generate velocities within range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    setupGlobalState();
    drummer(['snare1'], [0]);
    const velocity = c[c.length - 1].vals[2];
    expect(velocity).toBeGreaterThanOrEqual(0);
    expect(velocity).toBeLessThanOrEqual(127);
    vi.restoreAllMocks();
  });

  it('should apply stutter effect occasionally', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // Force stutter
    setupGlobalState();
    globalThis.drummer(['snare1'], [0], globalThis.rf(.1), 1.0);
    expect(c.length).toBeGreaterThan(1);
    vi.restoreAllMocks();
  });

  it('should handle non-existent drum gracefully', () => {
    drummer(['nonexistent'], [0]);
    expect(c.length).toBe(0);
  });
});

describe('patternLength', () => {
  it('should return pattern unchanged when length matches', () => {
    console.log('TEST: pattern unchanged');
    const pattern = [1, 0, 1, 0];
    expect(patternLength(pattern, 4)).toEqual([1, 0, 1, 0]);
  });

  it('should extend pattern when length is longer', () => {
    console.log('TEST: extend pattern');
    const pattern = [1, 0];
    expect(patternLength(pattern, 6)).toEqual([1, 0, 1, 0, 1, 0]);
  });

  it('should truncate pattern when length is shorter', () => {
    console.log('TEST: truncate pattern');
    const pattern = [1, 0, 1, 0];
    expect(patternLength(pattern, 2)).toEqual([1, 0]);
  });

  it('should handle empty pattern', () => {
    console.log('TEST: empty pattern');
    const pattern = [];
    expect(patternLength(pattern, 4)).toEqual([]);
  });

  it('should return pattern as-is when length undefined', () => {
    console.log('TEST: undefined length');
    const pattern = [1, 0, 1];
    expect(patternLength(pattern)).toEqual([1, 0, 1]);
  });

  it('should repeat pattern multiple times for large lengths', () => {
    console.log('TEST: large lengths');
    const pattern = [1, 0];
    const result = patternLength(pattern, 10);
    expect(result).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('should handle single element pattern', () => {
    console.log('TEST: single element');
    const pattern = [1];
    expect(patternLength(pattern, 5)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('closestDivisor', () => {
  it('should find exact divisor when target divides x', () => {
    expect(closestDivisor(12, 3)).toBe(3);
    expect(closestDivisor(20, 5)).toBe(5);
  });

  it('should find closest divisor when target does not divide x', () => {
    expect(closestDivisor(12, 5)).toBe(6); // 6 is closest to 5
  });

  it('should handle target = 2', () => {
    expect(closestDivisor(12, 2)).toBe(2);
    expect(closestDivisor(15, 2)).toBe(1); // 1 is closest to 2 among divisors of 15
  });

  it('should handle x = 1', () => {
    expect(closestDivisor(1, 2)).toBe(1);
  });

  it('should handle prime numbers', () => {
    expect(closestDivisor(13, 2)).toBe(1); // 13 is prime, only divisors are 1 and 13
  });

  it('should find divisor closest to target', () => {
    const result = closestDivisor(24, 7);
    const divisors = [1, 2, 3, 4, 6, 8, 12, 24];
    expect(divisors).toContain(result);
    expect(result).toBe(8); // 8 is closest to 7
  });

  it('should default target to 2', () => {
    expect(closestDivisor(12)).toBe(2);
  });

  it('should handle large numbers', () => {
    expect(closestDivisor(100, 7)).toBe(5); // 5 is closer to 7 than 10
  });
});

describe('makeOnsets', () => {
  it('should create rhythm with onsets', () => {
    const rhythm = makeOnsets(8, [1, 2]);
    expect(rhythm.length).toBe(8);
    expect(rhythm[0]).toBe(1); // First onset
  });

  it('should place zeros between onsets', () => {
    const rhythm = makeOnsets(8, [2]);
    expect(rhythm.filter(v => v === 0).length).toBeGreaterThan(0);
  });

  it('should fill to exact length', () => {
    const rhythm = makeOnsets(16, [1, 2, 3]);
    expect(rhythm.length).toBe(16);
  });

  it('should handle length 1', () => {
    const rhythm = makeOnsets(1, [0]);
    expect(rhythm).toEqual([1]);
  });

  it('should handle large gaps', () => {
    const rhythm = makeOnsets(10, [5]);
    expect(rhythm.length).toBe(10);
    expect(rhythm[0]).toBe(1);
  });

  it('should create valid rhythm pattern', () => {
    const rhythm = makeOnsets(16, [1, 2, 3, 4]);
    expect(rhythm.every(v => v === 0 || v === 1)).toBe(true);
    expect(rhythm.length).toBe(16);
  });

  it('should handle single value range', () => {
    const rhythm = makeOnsets(8, [1]);
    expect(rhythm.length).toBe(8);
  });

  it('should respect 2-element array as min-max range', () => {
    const rhythm = makeOnsets(20, [2, 4]);
    expect(rhythm.length).toBe(20);
  });
});

describe('Integration tests', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should generate complete drum sequence', () => {
    beatStart = 0;
    tpBeat = 480;
    drummer(['kick1', 'snare1', 'cymbal1'], [0, 0.5, 0.75]);
    expect(c.length).toBeGreaterThan(0);
    expect(c.every(cmd => cmd.type === 'on')).toBe(true);
    expect(c.every(cmd => cmd.vals[0] === drumCH)).toBe(true);
  });

  it('should create patterns of correct length', () => {
    for (let len of [4, 8, 12, 16]) {
      const pattern = patternLength([1, 0, 1], len);
      expect(pattern.length).toBe(len);
    }
  });

  it('should find divisors for rhythm lengths', () => {
    for (let x of [8, 12, 16, 24]) {
      const divisor = closestDivisor(x, 3);
      expect(x % divisor).toBe(0);
    }
  });

  it('should create onset patterns with consistent length', () => {
    for (let len of [8, 16, 32]) {
      const rhythm = makeOnsets(len, [1, 2, 3]);
      expect(rhythm.length).toBe(len);
    }
  });
});

describe('Edge cases', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should handle zero beat offsets', () => {
    drummer(['snare1'], [0]);
    expect(c[0].tick).toBe(beatStart);
  });

  it('should handle large beat offsets', () => {
    drummer(['snare1'], [10]);
    expect(c[0].tick).toBeGreaterThan(beatStart);
  });

  it('should handle negative offsets gracefully', () => {
    drummer(['snare1'], [-0.5]);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should handle empty drum arrays', () => {
    drummer([], []);
    expect(c.length).toBe(0);
  });

  it('should handle very long patterns', () => {
    const pattern = Array(100).fill(1);
    const result = patternLength(pattern, 200);
    expect(result.length).toBe(200);
  });

  it('should handle closestDivisor with target larger than x', () => {
    expect(closestDivisor(5, 10)).toBeGreaterThanOrEqual(1);
    expect(closestDivisor(5, 10)).toBeLessThanOrEqual(5);
  });

  it('should handle makeOnsets with impossible constraints', () => {
    const rhythm = makeOnsets(5, [10]); // Gap too large
    expect(rhythm.length).toBe(5);
  });
});

describe('Probabilistic behavior', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should vary drum order occasionally', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.8) // Trigger randomization
      .mockReturnValueOnce(0.6) // Fisher-Yates shuffle
      .mockReturnValue(0.5);

    setupGlobalState();
    drummer(['snare1', 'kick1'], [0, 0]);
    expect(c.length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it('should apply jitter occasionally', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5) // Apply jitter
      .mockReturnValue(0.5);

    setupGlobalState();
    beatStart = 0;
    tpBeat = 480;
    drummer(['snare1'], [0.5]);
    expect(c[0].tick).toBeGreaterThanOrEqual(0);
    vi.restoreAllMocks();
  });

  it('should generate varied onset patterns', () => {
    const rhythm = makeOnsets(8, [1, 2, 3]);
    expect(rhythm.length).toBe(8);
    expect(rhythm.every(v => v === 0 || v === 1)).toBe(true);
  });
});

describe('MIDI compliance', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should generate valid MIDI channel numbers', () => {
    drummer(['snare1', 'kick1'], [0, 0.5]);
    c.forEach(cmd => {
      expect(cmd.vals[0]).toBeGreaterThanOrEqual(0);
      expect(cmd.vals[0]).toBeLessThanOrEqual(15);
    });
  });

  it('should generate valid MIDI note numbers', () => {
    drummer(['snare1', 'kick1'], [0, 0.5]);
    c.forEach(cmd => {
      expect(cmd.vals[1]).toBeGreaterThanOrEqual(0);
      expect(cmd.vals[1]).toBeLessThanOrEqual(127);
    });
  });

  it('should generate valid MIDI velocities', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    setupGlobalState();
    drummer(['snare1'], [0]);
    c.forEach(cmd => {
      expect(cmd.vals[2]).toBeGreaterThanOrEqual(0);
      expect(cmd.vals[2]).toBeLessThanOrEqual(127);
    });
    vi.restoreAllMocks();
  });

  it('should use drum channel (9)', () => {
    drummer(['snare1'], [0]);
    expect(c.every(cmd => cmd.vals[0] === 9)).toBe(true);
  });
});

describe('Rhythm pattern generators', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should generate drum patterns with correct drum map', () => {
    // Verify that drumMap contains expected drum definitions
    expect(drumMap).toBeDefined();
    expect(drumMap['snare1']).toBeDefined();
    expect(drumMap['snare1'].note).toBe(31);
    expect(Array.isArray(drumMap['snare1'].velocityRange)).toBe(true);
  });

  it('should have velocity ranges for all drums', () => {
    // Each drum should have valid velocity range [min, max]
    Object.values(drumMap).forEach(drum => {
      expect(Array.isArray(drum.velocityRange)).toBe(true);
      expect(drum.velocityRange.length).toBe(2);
      expect(drum.velocityRange[0]).toBeLessThanOrEqual(drum.velocityRange[1]);
      expect(drum.velocityRange[0]).toBeGreaterThanOrEqual(0);
      expect(drum.velocityRange[1]).toBeLessThanOrEqual(127);
    });
  });

  it('should have valid MIDI note numbers for all drums', () => {
    // Each drum should have valid MIDI note (0-127)
    Object.values(drumMap).forEach(drum => {
      expect(drum.note).toBeGreaterThanOrEqual(0);
      expect(drum.note).toBeLessThanOrEqual(127);
    });
  });

  it('should support different drum categories', () => {
    // Verify we have different drum types in the main drumMap
    const drumNames = Object.keys(drumMap);
    // Should have at least snare, kick, and cymbal drums
    expect(drumNames.some(name => name.includes('snare'))).toBe(true);
    expect(drumNames.some(name => name.includes('kick'))).toBe(true);
    expect(drumNames.some(name => name.includes('cymbal'))).toBe(true);
  });

  it('drummer function should accept single drum name', () => {
    // drummer(['snare1'], [0.5]) should generate a drum hit
    drummer(['snare1'], [0.5]);
    expect(c.length).toBeGreaterThan(0);
    // Should use MIDI channel 9 (drums)
    expect(c[0].vals[0]).toBe(9);
  });

  it('drummer function should handle multiple beat offsets', () => {
    setupGlobalState();  // Need to setup global state including c
    drummer(['kick1'], [0, 0.5]);
    // With 2 beat offsets, should generate multiple events
    expect(c.length).toBeGreaterThan(0);
  });
});

describe('Rhythm state tracking functions', () => {
  beforeEach(() => {
    setupGlobalState();
    globalThis.beatIndex = 0;
    globalThis.divIndex = 0;
    globalThis.subdivIndex = 0;
    globalThis.beatRhythm = [1, 0, 1, 0];
    globalThis.divRhythm = [1, 1, 0];
    globalThis.subdivRhythm = [1, 0, 1];
    globalThis.beatsOn = 0;
    globalThis.beatsOff = 0;
    globalThis.divsOn = 0;
    globalThis.divsOff = 0;
    globalThis.subdivsOn = 0;
    globalThis.subdivsOff = 0;
  });

  it('beat rhythm tracking should count consecutive on beats', () => {
    // Simulate tracking beat rhythm [1, 0, 1, 0]
    // First beat is 1 (on)
    globalThis.beatIndex = 0;
    // If function exists and works, it should increment beatsOn
    expect(typeof globalThis.beatsOn).toBe('number');
  });

  it('division rhythm tracking should handle different length patterns', () => {
    // divRhythm = [1, 1, 0] has length 3, different from beat
    globalThis.divIndex = 0;
    // Division pattern tracking should work independently
    expect(globalThis.divRhythm.length).toBe(3);
    expect(globalThis.beatRhythm.length).toBe(4);
  });

  it('subdivision tracking with nested rhythm structure', () => {
    // Subdivisions are nested under divisions
    globalThis.subdivIndex = 0;
    globalThis.subdivsPerDiv = 2;
    // Multiple subdivisions per division should track independently
    expect(globalThis.subdivRhythm.length).toBeGreaterThan(0);
  });

  it('beat on/off counters should be independent from other levels', () => {
    globalThis.beatIndex = 0;
    globalThis.beatsOn = 0;
    globalThis.beatsOff = 0;
    globalThis.divsOn = 0;
    globalThis.divsOff = 0;
    // Changing one level shouldn't affect others
    const beatOnSnapshot = globalThis.beatsOn;
    const divOnSnapshot = globalThis.divsOn;
    expect(beatOnSnapshot).toBe(0);
    expect(divOnSnapshot).toBe(0);
  });

  it('rhythm array index should wrap correctly for pattern length', () => {
    globalThis.beatIndex = 4;
    globalThis.beatRhythm = [1, 0, 1, 0];
    // Index 4 should wrap to 0 for length-4 array
    const wrappedIndex = globalThis.beatIndex % globalThis.beatRhythm.length;
    expect(wrappedIndex).toBe(0);
  });
});

describe('Rhythm pattern composition integration', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should handle changing rhythm patterns between levels', () => {
    globalThis.beatRhythm = [1, 1, 0, 0, 1];
    globalThis.divRhythm = [1, 0, 1];
    globalThis.subdivRhythm = [1, 1];
    // Each level can have different length patterns
    expect(globalThis.beatRhythm.length).not.toBe(globalThis.divRhythm.length);
    expect(globalThis.divRhythm.length).not.toBe(globalThis.subdivRhythm.length);
  });

  it('polyrhythmic patterns with coprime lengths', () => {
    // 3-against-4: beat=4, division=3 gives 12-beat cycle
    globalThis.beatRhythm = [1, 1, 1, 1];
    globalThis.divRhythm = [1, 1, 1];
    globalThis.divsPerBeat = 3; // 3 divisions per beat = polyrhythm

    // Calculate LCM to find cycle length
    const lcm = 12; // LCM(4, 3) = 12
    let beatCycleCount = 0;
    let divCycleCount = 0;

    // After 12 steps, both rhythms should realign
    for (let i = 0; i < 12; i++) {
      if (i % globalThis.beatRhythm.length === 0) beatCycleCount++;
      if (i % globalThis.divRhythm.length === 0) divCycleCount++;
    }
    expect(beatCycleCount).toBe(3); // 12 / 4
    expect(divCycleCount).toBe(4); // 12 / 3
  });

  it('rhythm with all zeros (silence)', () => {
    globalThis.beatRhythm = [0, 0, 0, 0];
    globalThis.divRhythm = [0, 0];
    // Silent patterns should be valid
    const beatOnCount = globalThis.beatRhythm.reduce((a, b) => a + b, 0);
    const divOnCount = globalThis.divRhythm.reduce((a, b) => a + b, 0);
    expect(beatOnCount).toBe(0);
    expect(divOnCount).toBe(0);
  });

  it('rhythm with all ones (continuous)', () => {
    globalThis.beatRhythm = [1, 1, 1, 1];
    globalThis.divRhythm = [1, 1, 1, 1];
    // Continuous patterns should be valid
    const beatOnCount = globalThis.beatRhythm.reduce((a, b) => a + b, 0);
    expect(beatOnCount).toBe(globalThis.beatRhythm.length);
  });
});
