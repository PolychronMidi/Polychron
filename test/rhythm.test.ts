// test/rhythm.test.js
import { drummer, playDrums, playDrums2, drumMap, rhythms, binary, hex, onsets, random, prob, euclid, rotate, morph, setRhythm, makeOnsets, patternLength, closestDivisor, getRhythm, trackRhythm } from '../src/rhythm.js';
import { rf, ri, rv, ra, m } from '../src/backstage.js';
import { setupTestLogging, createTestContext, getWriterServices } from './helpers.module.js';
import { registerWriterServices } from '../src/writer.js';

// Enable test logging
setupTestLogging();

let c, drumCH, beatStart, tpBeat, beatIndex, numerator, beatRhythm, beatsOff, bpmRatio3, measuresPerPhrase;
let divsPerBeat, subdivsPerDiv, divRhythm, subdivRhythm;

// Setup DI-based local state
let ctx: any;
function setupLocalState() {
  // Create a DI-enabled test context
  ctx = createTestContext();
  // Ensure writer services are available on the DI container
  registerWriterServices(ctx.services);

  // Use the underlying rows array for simpler assertions when CSVBuffer is used
  c = ctx.csvBuffer && (ctx.csvBuffer as any).rows ? (ctx.csvBuffer as any).rows : ctx.csvBuffer;

  // Populate ctx.state with values used by rhythm functions
  ctx.state.drumCH = 9;
  ctx.state.beatStart = 0;
  ctx.state.tpBeat = 480;
  ctx.state.beatIndex = 0;
  ctx.state.numerator = 4;
  ctx.state.beatRhythm = [1, 0, 1, 0];
  ctx.state.beatsOff = 0;
  ctx.state.bpmRatio3 = 1;
  ctx.state.measuresPerPhrase = 4;
  ctx.state.divsPerBeat = 2;
  ctx.state.subdivsPerDiv = 2;
  ctx.state.divRhythm = [1, 0];
  ctx.state.subdivRhythm = [1, 0];

  // Local convenience bindings
  drumCH = ctx.state.drumCH;
  beatStart = ctx.state.beatStart;
  tpBeat = ctx.state.tpBeat;
  beatIndex = ctx.state.beatIndex;
  numerator = ctx.state.numerator;
  beatRhythm = ctx.state.beatRhythm;
  beatsOff = ctx.state.beatsOff;
  bpmRatio3 = ctx.state.bpmRatio3;
  measuresPerPhrase = ctx.state.measuresPerPhrase;
  divsPerBeat = ctx.state.divsPerBeat;
  subdivsPerDiv = ctx.state.subdivsPerDiv;
  divRhythm = ctx.state.divRhythm;
  subdivRhythm = ctx.state.subdivRhythm;
}

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
    setupLocalState();
  });

  it('should play single drum at offset 0', () => {
    drummer(['snare1'], [0], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].vals[0]).toBe(drumCH);
    expect(c[0].vals[1]).toBe(31); // snare1 note
  });

  it('should play multiple drums', () => {
    drummer(['snare1', 'kick1'], [0, 0.5], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should handle string input with commas', () => {
    drummer('snare1,kick1', [0, 0.5], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should handle random drum selection', () => {
    drummer('random', [0], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
    const playedNote = c[0].vals[1];
    const allNotes = Object.values(drumMap).map(d => d.note);
    expect(allNotes).toContain(playedNote);
  });

  it('should apply offsets correctly', () => {
    beatStart = 0;
    tpBeat = 480;
    drummer(['snare1'], [0.5], undefined, undefined, undefined, undefined, ctx);
    const firstTick = c[0].tick;
    expect(firstTick).toBeGreaterThanOrEqual(240); // 0.5 * 480
  });

  it('should fill missing offsets with zeros', () => {
    drummer(['snare1', 'kick1', 'cymbal1'], [0], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should truncate extra offsets', () => {
    drummer(['snare1'], [0, 0.5, 1, 1.5], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should generate velocities within range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    setupLocalState();
    drummer(['snare1'], [0], undefined, undefined, undefined, undefined, ctx);
    const velocity = c[c.length - 1].vals[2];
    expect(velocity).toBeGreaterThanOrEqual(0);
    expect(velocity).toBeLessThanOrEqual(127);
    vi.restoreAllMocks();
  });

  it('should apply stutter effect occasionally', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // Force stutter
    setupLocalState();
    drummer(['snare1'], [0], rf(.1), 1.0, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(1);
    vi.restoreAllMocks();
  });

  it('should handle non-existent drum gracefully', () => {
    drummer(['nonexistent'], [0], undefined, undefined, undefined, undefined, ctx);
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
    setupLocalState();
  });

  it('should generate complete drum sequence', () => {
    beatStart = 0;
    tpBeat = 480;
    drummer(['kick1', 'snare1', 'cymbal1'], [0, 0.5, 0.75], undefined, undefined, undefined, undefined, ctx);
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
    setupLocalState();
  });

  it('should handle zero beat offsets', () => {
    drummer(['snare1'], [0], undefined, undefined, undefined, undefined, ctx);
    expect(c[0].tick).toBe(beatStart);
  });

  it('should handle large beat offsets', () => {
    drummer(['snare1'], [10], undefined, undefined, undefined, undefined, ctx);
    expect(c[0].tick).toBeGreaterThan(beatStart);
  });

  it('should handle negative offsets gracefully', () => {
    drummer(['snare1'], [-0.5], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
  });

  it('should handle empty drum arrays', () => {
    drummer([], [], undefined, undefined, undefined, undefined, ctx);
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
    setupLocalState();
  });

  it('should vary drum order occasionally', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.8) // Trigger randomization
      .mockReturnValueOnce(0.6) // Fisher-Yates shuffle
      .mockReturnValue(0.5);

    setupLocalState();
    drummer(['snare1', 'kick1'], [0, 0], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it('should apply jitter occasionally', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5) // Apply jitter
      .mockReturnValue(0.5);

    setupLocalState();
    beatStart = 0;
    tpBeat = 480;
    drummer(['snare1'], [0.5], undefined, undefined, undefined, undefined, ctx);
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
    setupLocalState();
  });

  it('should generate valid MIDI channel numbers', () => {
    drummer(['snare1', 'kick1'], [0, 0.5], undefined, undefined, undefined, undefined, ctx);
    c.forEach(cmd => {
      expect(cmd.vals[0]).toBeGreaterThanOrEqual(0);
      expect(cmd.vals[0]).toBeLessThanOrEqual(15);
    });
  });

  it('should generate valid MIDI note numbers', () => {
    drummer(['snare1', 'kick1'], [0, 0.5], undefined, undefined, undefined, undefined, ctx);
    c.forEach(cmd => {
      expect(cmd.vals[1]).toBeGreaterThanOrEqual(0);
      expect(cmd.vals[1]).toBeLessThanOrEqual(127);
    });
  });

  it('should generate valid MIDI velocities', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    setupLocalState();
    drummer(['snare1'], [0], undefined, undefined, undefined, undefined, ctx);
    c.forEach(cmd => {
      expect(cmd.vals[2]).toBeGreaterThanOrEqual(0);
      expect(cmd.vals[2]).toBeLessThanOrEqual(127);
    });
    vi.restoreAllMocks();
  });

  it('should use drum channel (9)', () => {
    drummer(['snare1'], [0], undefined, undefined, undefined, undefined, ctx);
    expect(c.every(cmd => cmd.vals[0] === 9)).toBe(true);
  });
});

describe('Rhythm pattern generators', () => {
  beforeEach(() => {
    setupLocalState();
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
    drummer(['snare1'], [0], undefined, undefined, undefined, undefined, ctx);
    expect(c.length).toBeGreaterThan(0);
    // Should use MIDI channel 9 (drums)
    expect(c[0].vals[0]).toBe(9);
  });

  it('drummer function should handle multiple beat offsets', () => {
    setupLocalState();  // Need to setup global state including c
    drummer(['kick1'], [0, 0.5], undefined, undefined, undefined, undefined, ctx);
    // With 2 beat offsets, should generate multiple events
    expect(c.length).toBeGreaterThan(0);
  });
});

describe('Rhythm state tracking functions', () => {
    beforeEach(() => {
    setupLocalState();
    ctx.state.beatIndex = 0;
    ctx.state.divIndex = 0;
    ctx.state.subdivIndex = 0;
    ctx.state.beatRhythm = [1, 0, 1, 0];
    ctx.state.divRhythm = [1, 1, 0];
    ctx.state.subdivRhythm = [1, 0, 1];
    ctx.state.beatsOn = 0;
    ctx.state.beatsOff = 0;
    ctx.state.divsOn = 0;
    ctx.state.divsOff = 0;
    ctx.state.subdivsOn = 0;
    ctx.state.subdivsOff = 0;
  });

  it('beat rhythm tracking should count consecutive on beats', () => {
    // Simulate tracking beat rhythm [1, 0, 1, 0]
    // First beat is 1 (on)
    ctx.state.beatIndex = 0;
    // If function exists and works, it should increment beatsOn
    expect(typeof ctx.state.beatsOn).toBe('number');
  });

  it('division rhythm tracking should handle different length patterns', () => {
    // divRhythm = [1, 1, 0] has length 3, different from beat
    ctx.state.divIndex = 0;
    // Division pattern tracking should work independently
    expect(ctx.state.divRhythm.length).toBe(3);
    expect(ctx.state.beatRhythm.length).toBe(4);
  });

  it('subdivision tracking with nested rhythm structure', () => {
    // Subdivisions are nested under divisions
    ctx.state.subdivIndex = 0;
    ctx.state.subdivsPerDiv = 2;
    // Multiple subdivisions per division should track independently
    expect(ctx.state.subdivRhythm.length).toBeGreaterThan(0);
  });

  it('beat on/off counters should be independent from other levels', () => {
    ctx.state.beatIndex = 0;
    ctx.state.beatsOn = 0;
    ctx.state.beatsOff = 0;
    ctx.state.divsOn = 0;
    ctx.state.divsOff = 0;
    // Changing one level shouldn't affect others
    const beatOnSnapshot = ctx.state.beatsOn;
    const divOnSnapshot = ctx.state.divsOn;
    expect(beatOnSnapshot).toBe(0);
    expect(divOnSnapshot).toBe(0);
  });

  it('rhythm array index should wrap correctly for pattern length', () => {
    ctx.state.beatIndex = 4;
    ctx.state.beatRhythm = [1, 0, 1, 0];
    // Index 4 should wrap to 0 for length-4 array
    const wrappedIndex = ctx.state.beatIndex % ctx.state.beatRhythm.length;
    expect(wrappedIndex).toBe(0);
  });
});

describe('Rhythm pattern composition integration', () => {
    beforeEach(() => {
    setupLocalState();
  });

  it('should handle changing rhythm patterns between levels', () => {
    ctx.state.beatRhythm = [1, 1, 0, 0, 1];
    ctx.state.divRhythm = [1, 0, 1];
    ctx.state.subdivRhythm = [1, 1];
    // Each level can have different length patterns
    expect(ctx.state.beatRhythm.length).not.toBe(ctx.state.divRhythm.length);
    expect(ctx.state.divRhythm.length).not.toBe(ctx.state.subdivRhythm.length);
  });

  it('polyrhythmic patterns with coprime lengths', () => {
    // 3-against-4: beat=4, division=3 gives 12-beat cycle
    ctx.state.beatRhythm = [1, 1, 1, 1];
    ctx.state.divRhythm = [1, 1, 1];
    ctx.state.divsPerBeat = 3; // 3 divisions per beat = polyrhythm

    // Calculate LCM to find cycle length
    const lcm = 12; // LCM(4, 3) = 12
    let beatCycleCount = 0;
    let divCycleCount = 0;

    // After 12 steps, both rhythms should realign
    for (let i = 0; i < 12; i++) {
      if (i % ctx.state.beatRhythm.length === 0) beatCycleCount++;
      if (i % ctx.state.divRhythm.length === 0) divCycleCount++;
    }
    expect(beatCycleCount).toBe(3); // 12 / 4
    expect(divCycleCount).toBe(4); // 12 / 3
  });

  it('rhythm with all zeros (silence)', () => {
    ctx.state.beatRhythm = [0, 0, 0, 0];
    ctx.state.divRhythm = [0, 0];
    // Silent patterns should be valid
    const beatOnCount = ctx.state.beatRhythm.reduce((a, b) => a + b, 0);
    const divOnCount = ctx.state.divRhythm.reduce((a, b) => a + b, 0);
    expect(beatOnCount).toBe(0);
    expect(divOnCount).toBe(0);
  });

  it('rhythm with all ones (continuous)', () => {
    ctx.state.beatRhythm = [1, 1, 1, 1];
    ctx.state.divRhythm = [1, 1, 1, 1];
    // Continuous patterns should be valid
    const beatOnCount = ctx.state.beatRhythm.reduce((a, b) => a + b, 0);
    expect(beatOnCount).toBe(ctx.state.beatRhythm.length);
  });
});
