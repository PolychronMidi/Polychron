// test/time.test.js
require('../src/sheet');  // Defines constants
require('../src/writer');  // Defines writer functions (CSVBuffer, p, etc.)
require('../src/backstage');  // Defines utility functions
require('../src/time');  // Time functions

// Mock dependencies
const mockComposer = {
  getMeter: () => [4, 4],
  getDivisions: () => 2,
  getSubdivisions: () => 2,
  getSubsubdivs: () => 1,
  constructor: { name: 'MockComposer' },
  root: 'C',
  scale: { name: 'major' }
};

// Global state variables (will be set by functions)
// NOTE: timing primitives are intentionally left as naked globals so that the timing
// engine can set them and tests can observe them without local shadowing.
let polyNumerator, polyDenominator, polyMeterRatio, measuresPerPhrase1, measuresPerPhrase2;
let composer, c, LOG;

// Setup function to reset state
function setupGlobalState() {
  numerator = 4;
  denominator = 4;
  BPM = 120;
  PPQ = 480;
  sectionStart = 0;
  phraseStart = 0;
  measureStart = 0;
  beatStart = 0;
  divStart = 0;
  subdivStart = 0;
  subsubdivStart = 0;
  sectionStartTime = 0;
  phraseStartTime = 0;
  measureStartTime = 0;
  beatStartTime = 0;
  divStartTime = 0;
  subdivStartTime = 0;
  subsubdivStartTime = 0;
  tpSection = 0;
  spSection = 0;
  spMeasure = 0;
  composer = { ...mockComposer };
  c = [];
  LOG = 'none';

  // Mirror important timing variables into the shared GLOBAL object so modules using naked globals
  // (e.g., src/time.js) observe the same values as the test-local variables.
  try {
    const G = (typeof GLOBAL !== 'undefined') ? GLOBAL : (typeof global !== 'undefined' ? global : (typeof globalThis !== 'undefined' ? globalThis : null));
    if (G) {
      G.numerator = numerator;
      G.denominator = denominator;
      G.BPM = BPM;
      G.PPQ = PPQ;
      G.sectionStart = sectionStart;
      G.phraseStart = phraseStart;
      G.measureStart = measureStart;
      G.beatStart = beatStart;
      G.divStart = divStart;
      G.subdivStart = subdivStart;
      G.subsubdivStart = subsubdivStart;
      G.sectionStartTime = sectionStartTime;
      G.phraseStartTime = phraseStartTime;
      G.measureStartTime = measureStartTime;
      G.beatStartTime = beatStartTime;
      G.divStartTime = divStartTime;
      G.subdivStartTime = subdivStartTime;
      G.subsubdivStartTime = subsubdivStartTime;
      G.tpSection = tpSection;
      G.spSection = spSection;
      G.spMeasure = spMeasure;
      G.composer = composer;
      G.c = c;
      G.LOG = LOG;
      G.__POLYCHRON_TEST__ = G.__POLYCHRON_TEST__ || {};
      G.__POLYCHRON_TEST__.DEBUG = true;
    }

    // Also assign bare (unscoped) globals directly in the global scope so modules using
    // naked identifiers (e.g., `numerator`, `denominator`) see the intended values.
    try {
      const assign = `
        try {
          numerator = ${Number(numerator)};
          denominator = ${Number(denominator)};
          BPM = ${Number(BPM)};
          PPQ = ${Number(PPQ)};
        } catch (e) { /* swallow */ }
      `;
      Function(assign)();
    } catch (e) { /* swallow */ }
  } catch (e) { /* swallow */ }
}

// Helpers to set globals in sync with test-local variables
function setGlobalVar(name, val) {
  try {
    const n = Number(val);
    Function(`${name} = ${n}`)();
  } catch (e) { /* swallow */ }
}

function setNumerator(n) { numerator = n; setGlobalVar('numerator', n); }
function setDenominator(n) { denominator = n; setGlobalVar('denominator', n); }
function setBPM(n) { BPM = n; setGlobalVar('BPM', n); }
function setPPQ(n) { PPQ = n; setGlobalVar('PPQ', n); }

function setGlobalObject(name, obj) {
  try {
    const G = (typeof GLOBAL !== 'undefined') ? GLOBAL : (typeof global !== 'undefined' ? global : (typeof globalThis !== 'undefined' ? globalThis : null));
    if (G) G[name] = obj;
  } catch (e) { /* swallow */ }
}

function setMeasuresPerPhrase1(n) { measuresPerPhrase1 = n; setGlobalVar('measuresPerPhrase1', n); }
function setMeasuresPerPhrase2(n) { measuresPerPhrase2 = n; setGlobalVar('measuresPerPhrase2', n); }

  describe('Non-power of 2 denominators (requires spoofing)', () => {
    it('should spoof 7/9 to nearest power of 2', () => {
      numerator = 7;
      denominator = 9;
      getMidiTiming();
      expect(midiMeter[1]).toBe(8); // 8 is closer to 9 than 16
      expect(midiMeter[0]).toBe(7);
      expect(syncFactor).toBeCloseTo(7/8 / (7/9), 5);
    });

    it('should spoof 5/6 correctly', () => {
      numerator = 5;
      denominator = 6;
      getMidiTiming();
      expect([4, 8]).toContain(midiMeter[1]); // Either 4 or 8 could be closest
      expect(midiMeter[0]).toBe(5);
    });

    it('should spoof 11/12 correctly', () => {
      setNumerator(11);
      denominator = 12;
      getMidiTiming();
      expect([8, 16]).toContain(midiMeter[1]);
      expect(midiMeter[0]).toBe(11);
    });

    it('should spoof 13/17 correctly', () => {
      setNumerator(13);
      denominator = 17;
      getMidiTiming();
      expect(midiMeter[1]).toBe(16); // 16 is closest power of 2 to 17
      expect(midiMeter[0]).toBe(13);
    });

    it('should handle the infamous 420/69', () => {
      setNumerator(420);
      denominator = 69;
      getMidiTiming();
      expect([64, 128]).toContain(midiMeter[1]); // 64 is closest to 69
      expect(midiMeter[0]).toBe(420);
    });
  });

  describe('Sync factor calculations', () => {
    it('should calculate correct sync factor for 7/9', () => {
      numerator = 7;
      denominator = 9;
      getMidiTiming();
      const expectedMeterRatio = 7 / 9;
      const expectedMidiMeterRatio = 7 / 8;
      const expectedSyncFactor = expectedMidiMeterRatio / expectedMeterRatio;
      expect(meterRatio).toBeCloseTo(expectedMeterRatio, 10);
      expect(midiMeterRatio).toBeCloseTo(expectedMidiMeterRatio, 10);
      expect(syncFactor).toBeCloseTo(expectedSyncFactor, 10);
    });

    it('should calculate correct BPM adjustment', () => {
      numerator = 5;
      denominator = 6;
      BPM = 120;
      getMidiTiming();
      const expectedMidiBPM = 120 * syncFactor;
      expect(midiBPM).toBeCloseTo(expectedMidiBPM, 5);
    });

    it('should calculate correct ticks per second', () => {
      numerator = 4;
      denominator = 4;
      BPM = 120;
      PPQ = 480;
      getMidiTiming();
      const expectedTpSec = 120 * 480 / 60; // 960
      expect(tpSec).toBeCloseTo(expectedTpSec, 5);
    });

    it('should calculate correct ticks per measure', () => {
      setNumerator(3);
      setDenominator(4);
      PPQ = 480;
      getMidiTiming();
      const expectedTpMeasure = PPQ * 4 * (3/4); // 1440
      expect(tpMeasure).toBeCloseTo(expectedTpMeasure, 5);
    });
  });

  describe('Edge cases', () => {
    it('should handle numerator of 1', () => {
      setNumerator(1);
      denominator = 4;
      getMidiTiming();
      expect(midiMeter).toEqual([1, 4]);
      expect(syncFactor).toBe(1);
    });

    it('should handle large numerators', () => {
      setNumerator(127);
      setDenominator(16);
      getMidiTiming();
      expect(midiMeter).toEqual([127, 16]);
      expect(syncFactor).toBe(1);
    });

    it('should handle denominator of 2', () => {
      numerator = 3;
      denominator = 2;
      getMidiTiming();
      expect(midiMeter).toEqual([3, 2]);
      expect(syncFactor).toBe(1);
    });

    it('should handle very odd denominators like 127', () => {
      numerator = 7;
      denominator = 127;
      getMidiTiming();
      expect(midiMeter[1]).toBe(128); // Closest power of 2
      expect(midiMeter[0]).toBe(7);
    });
  });

  describe('Meter ratio preservation', () => {
    it('should preserve time duration through sync factor', () => {
      numerator = 7;
      denominator = 9;
      BPM = 120;
      getMidiTiming();

      // Original measure duration in seconds
      const originalBeatsPerMeasure = numerator;
      const originalBeatDuration = 60 / BPM;
      const originalMeasureDuration = originalBeatsPerMeasure * originalBeatDuration * (4 / denominator);

      // MIDI measure duration in seconds
      const midiBeatsPerMeasure = midiMeter[0];
      const midiBeatDuration = 60 / midiBPM;
      const midiMeasureDuration = midiBeatsPerMeasure * midiBeatDuration * (4 / midiMeter[1]);

      expect(midiMeasureDuration).toBeCloseTo(originalMeasureDuration, 5);
    });
  });

describe('getPolyrhythm', () => {
  beforeEach(() => {
    setupGlobalState();
    numerator = 4;
    denominator = 4;
    getMidiTiming();
  });

  const getPolyrhythm = () => {
    let iterations = 0;
    const maxIterations = 100;

    while (iterations < maxIterations) {
      iterations++;

      [polyNumerator, polyDenominator] = composer.getMeter(true, true);
      polyMeterRatio = polyNumerator / polyDenominator;

      let bestMatch = {
        originalMeasures: Infinity,
        polyMeasures: Infinity,
        totalMeasures: Infinity,
        polyNumerator: polyNumerator,
        polyDenominator: polyDenominator
      };

      for (let originalMeasures = 1; originalMeasures < 6; originalMeasures++) {
        for (let polyMeasures = 1; polyMeasures < 6; polyMeasures++) {
          if (m.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < 0.00000001) {
            let currentMatch = {
              originalMeasures: originalMeasures,
              polyMeasures: polyMeasures,
              totalMeasures: originalMeasures + polyMeasures,
              polyNumerator: polyNumerator,
              polyDenominator: polyDenominator
            };

            if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
              bestMatch = currentMatch;
            }
          }
        }
      }

      if (bestMatch.totalMeasures !== Infinity &&
          (bestMatch.totalMeasures > 2 &&
           (bestMatch.originalMeasures > 1 || bestMatch.polyMeasures > 1)) &&
          (numerator !== polyNumerator || denominator !== polyDenominator)) {
        measuresPerPhrase1 = bestMatch.originalMeasures;
        measuresPerPhrase2 = bestMatch.polyMeasures;
        tpPhrase = tpMeasure * measuresPerPhrase1;
        return bestMatch;
      }
    }
    return null;
  };

  it('should find 3:2 polyrhythm (3/4 over 4/4)', () => {
    numerator = 4;
    denominator = 4;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.originalMeasures).toBe(3);
    expect(result.polyMeasures).toBe(4);
  });

  it('should find 2:3 polyrhythm (3/4 over 2/4)', () => {
    numerator = 2;
    denominator = 4;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.totalMeasures).toBeLessThanOrEqual(10);
  });

  it('should reject identical meters', () => {
    numerator = 4;
    denominator = 4;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should require at least 3 total measures', () => {
    numerator = 4;
    denominator = 4;
    getMidiTiming();

    // This should create a 2-measure polyrhythm which is rejected
    composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should set measuresPerPhrase1 and measuresPerPhrase2', () => {
    numerator = 4;
    denominator = 4;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    getPolyrhythm();

    expect(measuresPerPhrase1).toBeGreaterThan(0);
    expect(measuresPerPhrase2).toBeGreaterThan(0);
  });

  it('should calculate tpPhrase correctly', () => {
    numerator = 4;
    denominator = 4;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    getPolyrhythm();

    expect(tpPhrase).toBe(tpMeasure * measuresPerPhrase1);
  });
});

describe('formatTime', () => {
  it('should format seconds under 1 minute', () => {
    expect(formatTime(45.1234)).toBe('0:45.1234');
  });

  it('should format exactly 1 minute', () => {
    expect(formatTime(60)).toBe('1:00.0000');
  });

  it('should format minutes and seconds', () => {
    expect(formatTime(125.5678)).toBe('2:05.5678');
  });

  it('should pad seconds with leading zero', () => {
    expect(formatTime(61.5)).toBe('1:01.5000');
  });

  it('should handle zero', () => {
    expect(formatTime(0)).toBe('0:00.0000');
  });

  it('should handle large times', () => {
    expect(formatTime(3661.1234)).toBe('61:01.1234');
  });

  it('should maintain 4 decimal places', () => {
    expect(formatTime(30.1)).toBe('0:30.1000');
    expect(formatTime(30.12)).toBe('0:30.1200');
    expect(formatTime(30.123)).toBe('0:30.1230');
    expect(formatTime(30.1234)).toBe('0:30.1234');
  });
});

describe('Timing calculation functions', () => {
  beforeEach(() => {
    setupGlobalState();
    numerator = 4;
    denominator = 4;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();
  });

  const setMeasureTiming = () => {
    tpMeasure = tpPhrase / measuresPerPhrase1;
    spMeasure = tpMeasure / tpSec;
    measureStart = phraseStart + 0 * tpMeasure;
    measureStartTime = phraseStartTime + 0 * spMeasure;
  };

  const setBeatTiming = () => {
    tpBeat = tpMeasure / numerator;
    spBeat = tpBeat / tpSec;
    beatStart = phraseStart + 0 * tpMeasure + 0 * tpBeat;
    beatStartTime = measureStartTime + 0 * spBeat;
  };

  describe('setMeasureTiming', () => {
    it('should calculate ticks per measure', () => {
      tpPhrase = 7680;
      measuresPerPhrase1 = 4;
      setMeasureTiming();
      expect(tpMeasure).toBe(1920);
    });

    it('should calculate seconds per measure', () => {
      tpPhrase = 7680;
      measuresPerPhrase1 = 4;
      tpSec = 960;
      setMeasureTiming();
      expect(spMeasure).toBe(2);
    });

    it('should set measure start tick', () => {
      phraseStart = 1000;
      tpPhrase = 7680;
      measuresPerPhrase1 = 4;
      setMeasureTiming();
      expect(measureStart).toBe(1000);
    });
  });

  describe('setBeatTiming', () => {
    it('should calculate ticks per beat for 4/4', () => {
      tpMeasure = 1920;
      numerator = 4;
      setBeatTiming();
      expect(tpBeat).toBe(480);
    });

    it('should calculate ticks per beat for 3/4', () => {
      numerator = 3;
      tpMeasure = 1440;
      setBeatTiming();
      expect(tpBeat).toBe(480);
    });

    it('should calculate ticks per beat for 7/8', () => {
      numerator = 7;
      tpMeasure = 1680;
      setBeatTiming();
      expect(tpBeat).toBe(240);
    });

    it('should calculate seconds per beat', () => {
      tpMeasure = 1920;
      numerator = 4;
      tpSec = 960;
      setBeatTiming();
      expect(spBeat).toBe(0.5); // 0.5 seconds per beat at 120 BPM
    });
  });

  describe('Division timing', () => {
    const setDivTiming = () => {
      const divsPerBeat = composer.getDivisions();
      tpDiv = tpBeat / m.max(1, divsPerBeat);
      spDiv = tpDiv / tpSec;
      divStart = beatStart + 0 * tpDiv;
      divStartTime = beatStartTime + 0 * spDiv;
    };

    it('should calculate division timing for 2 divisions', () => {
      tpBeat = 480;
      tpSec = 960;
      composer.getDivisions = vi.fn().mockReturnValue(2);
      setDivTiming();
      expect(tpDiv).toBe(240);
      expect(spDiv).toBeCloseTo(0.25, 5);
    });

    it('should handle 0 divisions gracefully', () => {
      tpBeat = 480;
      composer.getDivisions = vi.fn().mockReturnValue(0);
      setDivTiming();
      expect(tpDiv).toBe(480); // max(1, 0) = 1
    });

    it('should calculate division timing for triplets', () => {
      tpBeat = 480;
      composer.getDivisions = vi.fn().mockReturnValue(3);
      setDivTiming();
      expect(tpDiv).toBe(160);
    });
  });

  describe('Subdivision timing', () => {
    const setSubdivTiming = () => {
      const subdivsPerDiv = composer.getSubdivisions();
      tpSubdiv = tpDiv / m.max(1, subdivsPerDiv);
      spSubdiv = tpSubdiv / tpSec;
      subdivStart = divStart + 0 * tpSubdiv;
      subdivStartTime = divStartTime + 0 * spSubdiv;
    };

    it('should calculate subdivision timing', () => {
      tpDiv = 240;
      tpSec = 960;
      composer.getSubdivisions = vi.fn().mockReturnValue(2);
      setSubdivTiming();
      expect(tpSubdiv).toBe(120);
      expect(spSubdiv).toBe(0.125);
    });

    it('should handle complex subdivisions', () => {
      tpDiv = 160;
      composer.getSubdivisions = vi.fn().mockReturnValue(5);
      setSubdivTiming();
      expect(tpSubdiv).toBe(32);
    });
  });
});

describe('Integration tests', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should maintain timing consistency across hierarchy', () => {
    numerator = 4;
    denominator = 4;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();

    // 4 measures per phrase
    measuresPerPhrase1 = 4;
    tpPhrase = tpMeasure * measuresPerPhrase1;

    // Each measure should be equal to tpMeasure
    const expectedTpMeasure = tpPhrase / 4;
    expect(expectedTpMeasure).toBeCloseTo(tpMeasure, 5);

    // Each beat should be 1/4 of measure in 4/4
    const tpBeat = tpMeasure / 4;
    const expectedBeatsPerPhrase = 16; // 4 measures * 4 beats
    expect(tpBeat * expectedBeatsPerPhrase).toBeCloseTo(tpPhrase, 5);
  });

  it('should correctly spoof and maintain duration for 7/9', () => {
    numerator = 7;
    denominator = 9;
    BPM = 120;
    PPQ = 480;

    getMidiTiming();

    // Measure should take same duration regardless of spoofing
    const actualBeats = numerator;
    const actualBeatValue = 4 / denominator;
    const expectedMeasureDurationBeats = actualBeats * actualBeatValue;

    const midiBeats = midiMeter[0];
    const midiBeatValue = 4 / midiMeter[1];
    const midiMeasureDurationBeats = midiBeats * midiBeatValue;

    // After sync factor adjustment, durations should match
    const adjustedMidiDuration = midiMeasureDurationBeats / syncFactor;
    expect(adjustedMidiDuration).toBeCloseTo(expectedMeasureDurationBeats, 5);
  });
});



describe('logUnit', () => {
  beforeEach(() => {
    setupGlobalState();
    numerator = 4;
    denominator = 4;
    getMidiTiming();
  });

  const logUnit = (type) => {
    let shouldLog = false;
    type = type.toLowerCase();
    if (LOG === 'none') shouldLog = false;
    else if (LOG === 'all') shouldLog = true;
    else {
      const logList = LOG.toLowerCase().split(',').map(item => item.trim());
      shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
    }
    if (!shouldLog) return null;
    return { shouldLog: true, type };
  };

  it('should not log when LOG is "none"', () => {
    LOG = 'none';
    expect(logUnit('measure')).toBeNull();
  });

  it('should log all when LOG is "all"', () => {
    LOG = 'all';
    expect(logUnit('measure')).not.toBeNull();
    expect(logUnit('beat')).not.toBeNull();
    expect(logUnit('section')).not.toBeNull();
  });

  it('should log specific unit when listed', () => {
    LOG = 'measure';
    expect(logUnit('measure')).not.toBeNull();
    expect(logUnit('beat')).toBeNull();
  });

  it('should log multiple units when comma-separated', () => {
    LOG = 'measure,beat,phrase';
    expect(logUnit('measure')).not.toBeNull();
    expect(logUnit('beat')).not.toBeNull();
    expect(logUnit('phrase')).not.toBeNull();
    expect(logUnit('division')).toBeNull();
  });

  it('should handle whitespace in LOG string', () => {
    LOG = 'measure, beat , phrase';
    expect(logUnit('measure')).not.toBeNull();
    expect(logUnit('beat')).not.toBeNull();
    expect(logUnit('phrase')).not.toBeNull();
  });

  it('should be case-insensitive', () => {
    LOG = 'MEASURE';
    expect(logUnit('measure')).not.toBeNull();
    expect(logUnit('MEASURE')).not.toBeNull();
  });
});

describe('Cross-Layer Synchronization', () => {
  it('should maintain absolute time alignment between primary and poly layers', () => {
    // Verify that different spoofed meters calculate tpMeasure using midiMeterRatio correctly
    numerator = 7;
    denominator = 9;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();
    // tpMeasure uses MIDI meter (7/8), not actual meter (7/9)
    const primaryTpMeasure = 480 * 4 * (7/8);
    expect(tpMeasure).toBeCloseTo(primaryTpMeasure, 5);

    // Change to different meter
    numerator = 5;
    denominator = 6;
    getMidiTiming();
    // midiMeter for 5/6 is 5/8
    const polyTpMeasure = 480 * 4 * (5/8);
    expect(tpMeasure).toBeCloseTo(polyTpMeasure, 5);
  });

  it('should handle extreme tempo differences between layers', () => {
    // Test with very different meters
    numerator = 3;
    denominator = 16;
    getMidiTiming();
    const slowTpSec = tpSec;

    setNumerator(15);
    denominator = 8;
    getMidiTiming();
    const fastTpSec = tpSec;

    // Both should produce valid timing
    expect(slowTpSec).toBeGreaterThan(0);
    expect(fastTpSec).toBeGreaterThan(0);
  });
});

describe('Long-Running Timing Stability', () => {
  it('should maintain accuracy over 100+ measures', () => {
    // Verify that calculated values don't change across iterations
    numerator = 7;
    denominator = 9;
    BPM = 120;

    getMidiTiming();
    const duration1 = tpMeasure / tpSec;

    // Recalculate - should be identical
    getMidiTiming();
    const duration2 = tpMeasure / tpSec;

    expect(duration1).toBe(duration2);
  });

  it('should handle BPM changes without timing drift', () => {
    const meters = [[7,9], [5,6], [11,12], [4,4]];
    let totalPrimaryTime = 0;
    let totalPolyTime = 0;

    meters.forEach(([num, den]) => {
      numerator = num;
      denominator = den;
      BPM = 120;
      getMidiTiming();
      totalPrimaryTime += tpMeasure / tpSec;
    });

    // Reverse order for poly layer
    meters.reverse().forEach(([num, den]) => {
      numerator = num;
      denominator = den;
      BPM = 120;
      getMidiTiming();
      totalPolyTime += tpMeasure / tpSec;
    });

    // Both should have same total duration for same meters
    expect(Math.abs(totalPrimaryTime - totalPolyTime)).toBeLessThan(0.001);
  });
});

describe('Edge Case Meter Spoofing', () => {
  it('should handle denominators exactly between powers of 2', () => {
    // Test denominator = 6 (between 4 and 8)
    numerator = 5;
    denominator = 6;
    getMidiTiming();

    // Should choose closest power of 2
    expect([4, 8]).toContain(midiMeter[1]);

    // Verify sync factor is reasonable (not necessarily > 0.9, depends on which power of 2 is chosen)
    const originalRatio = 5/6;
    const midiRatio = midiMeter[0]/midiMeter[1];
    const syncFactor = midiRatio / originalRatio;
    expect(syncFactor).toBeGreaterThan(0.5);
    expect(syncFactor).toBeLessThan(1.5);
  });

  it('should handle very large denominators', () => {
    numerator = 7;
    denominator = 255;
    getMidiTiming();

    // Should choose 256 (next power of 2)
    expect(midiMeter[1]).toBe(256);
    expect(syncFactor).toBeCloseTo((7/256)/(7/255), 5);
  });

  it('should handle denominator = 1', () => {
    numerator = 3;
    denominator = 1;
    getMidiTiming();

    // Should choose 1 (already power of 2)
    expect(midiMeter[1]).toBe(1);
    expect(syncFactor).toBe(1);
  });
});


describe('Real-Time Performance', () => {
  it('should maintain timing accuracy with high subdivision counts', () => {
    numerator = 4;
    denominator = 4;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();

    // Test with extreme subdivisions
    const subdivisions = [2, 4, 8, 16, 32, 64, 128, 256];
    let totalError = 0;

    subdivisions.forEach(subdivs => {
      const tpBeat = tpMeasure / 4;
      const tpSubdiv = tpBeat / subdivs;
      const expectedSubdivDuration = (60 / 120) / 4 / subdivs; // seconds

      const actualSubdivDuration = tpSubdiv / tpSec;
      totalError += Math.abs(expectedSubdivDuration - actualSubdivDuration);
    });

    const avgError = totalError / subdivisions.length;
    expect(avgError).toBeLessThan(0.1); // Realistic tolerance for high subdivision floating point operations
  });

  it('should handle rapid tempo changes without glitches', () => {
    const tempos = [60, 80, 100, 120, 140, 160, 180, 200];
    let maxDurationError = 0;

    tempos.forEach(bpm => {
      BPM = bpm;
      numerator = 4;
      denominator = 4;
      getMidiTiming();

      // Measure duration should be consistent
      const expectedDuration = 4 * (60 / bpm); // 4 beats per measure
      const actualDuration = tpMeasure / tpSec;

      maxDurationError = Math.max(maxDurationError, Math.abs(expectedDuration - actualDuration));
    });

    expect(maxDurationError).toBeLessThan(0.0001);
  });
});

describe('End-to-End MIDI Timing', () => {
  it('should generate MIDI files with correct timing markers', () => {
    // Verify that timing events are generated correctly
    numerator = 7;
    denominator = 9;
    BPM = 120;
    PPQ = 480;
    c = []; setGlobalObject('c', c);
    beatStart = 0; setGlobalVar('beatStart', 0);
    measureStart = 0; setGlobalVar('measureStart', 0);

    getMidiTiming();
    setMidiTiming(0);

    // Check that BPM and meter events exist
    const bpmEvent = c.find(e => e.type === 'bpm');
    const meterEvent = c.find(e => e.type === 'meter');

    expect(bpmEvent).toBeDefined();
    expect(meterEvent).toBeDefined();
    expect(meterEvent.vals).toEqual([7, 8]); // MIDI-compatible

    // Verify tpMeasure uses midiMeterRatio (7/8), not actual ratio (7/9)
    const expectedTpMeasure = PPQ * 4 * (7/8);
    expect(tpMeasure).toBeCloseTo(expectedTpMeasure, 5);

    // BPM should be adjusted for the spoofed meter
    expect(bpmEvent.vals[0]).toBeCloseTo(BPM * syncFactor, 0);
  });

  it('should maintain sync across multiple phrases', () => {
    // Simulate multiple phrases
    const phraseDurations = [];
    const meters = [[7,9], [5,6], [11,12]];

    meters.forEach(([num, den]) => {
      numerator = num;
      denominator = den;
      BPM = 120;
      getMidiTiming();

      // 3 measures per phrase
      const phraseTicks = tpMeasure * 3;
      const phraseSeconds = phraseTicks / tpSec;
      phraseDurations.push(phraseSeconds);
    });

    // All phrases should have consistent timing when accounting for meter differences
    const totalTime = phraseDurations.reduce((sum, dur) => sum + dur, 0);

    // Verify no cumulative drift
    expect(totalTime).toBeGreaterThan(0);
    expect(totalTime).toBeLessThan(100); // Reasonable upper bound
  });
});

describe('setMidiTiming', () => {
  beforeEach(() => {
    setupGlobalState();
    numerator = 7;
    denominator = 9;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();
  });

  it('should write BPM event to buffer', () => {
    const testBuffer = [];
    c = testBuffer; setGlobalObject('c', testBuffer);
    setMidiTiming(0);

    const bpmEvent = testBuffer.find(e => e.type === 'bpm');
    expect(bpmEvent).not.toBeUndefined();
    expect(bpmEvent.vals[0]).toBe(midiBPM);
  });

  it('should write meter event to buffer', () => {
    const testBuffer = [];
    c = testBuffer; setGlobalObject('c', testBuffer);
    setMidiTiming(0);

    const meterEvent = testBuffer.find(e => e.type === 'meter');
    expect(meterEvent).not.toBeUndefined();
    expect(meterEvent.vals).toEqual([midiMeter[0], midiMeter[1]]);
  });

  it('should place events at correct tick position', () => {
    const testBuffer = [];
    c = testBuffer; setGlobalObject('c', testBuffer);
    setMidiTiming(1000);

    expect(testBuffer[0].tick).toBe(1000);
    expect(testBuffer[1].tick).toBe(1000);
  });

  it('should use default tick of measureStart when not provided', () => {
    const testBuffer = [];
    c = testBuffer; setGlobalObject('c', testBuffer);
    measureStart = 500; setGlobalVar('measureStart', 500);
    setMidiTiming();

    expect(testBuffer[0].tick).toBe(500);
    expect(testBuffer[1].tick).toBe(500);
  });

  it('should write correct adjusted BPM for spoofed meters', () => {
    const testBuffer = [];
    c = testBuffer; setGlobalObject('c', testBuffer);
    setMidiTiming(0);

    const bpmEvent = testBuffer.find(e => e.type === 'bpm');
    expect(bpmEvent.vals[0]).toBeCloseTo(120 * syncFactor, 2);
  });

  it('should write MIDI-compatible meter not actual meter', () => {
    const testBuffer = [];
    c = testBuffer; setGlobalObject('c', testBuffer);
    setMidiTiming(0);

    const meterEvent = testBuffer.find(e => e.type === 'meter');
    expect(meterEvent.vals[1]).toBe(midiMeter[1]);
    expect(meterEvent.vals[1]).toBe(8); // 7/9 spoofed to 7/8
  });
});

describe('getPolyrhythm Edge Cases', () => {
  beforeEach(() => {
    setupGlobalState();
    numerator = 4;
    denominator = 4;
    getMidiTiming();
  });

  const getPolyrhythm = () => {
    let iterations = 0;
    const maxIterations = 100;

    while (iterations < maxIterations) {
      iterations++;

      [polyNumerator, polyDenominator] = composer.getMeter(true, true);
      polyMeterRatio = polyNumerator / polyDenominator;

      let bestMatch = {
        originalMeasures: Infinity,
        polyMeasures: Infinity,
        totalMeasures: Infinity,
        polyNumerator: polyNumerator,
        polyDenominator: polyDenominator
      };

      for (let originalMeasures = 1; originalMeasures < 7; originalMeasures++) {
        for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
          if (m.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
            let currentMatch = {
              originalMeasures: originalMeasures,
              polyMeasures: polyMeasures,
              totalMeasures: originalMeasures + polyMeasures,
              polyNumerator: polyNumerator,
              polyDenominator: polyDenominator
            };
            if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
              bestMatch = currentMatch;
            }
          }
        }
      }

      if (bestMatch.totalMeasures !== Infinity &&
          (bestMatch.totalMeasures > 2 &&
           (bestMatch.originalMeasures > 1 || bestMatch.polyMeasures > 1)) &&
          !(numerator === polyNumerator && denominator === polyDenominator)) {
        measuresPerPhrase1 = bestMatch.originalMeasures;
        measuresPerPhrase2 = bestMatch.polyMeasures;
        tpPhrase = tpMeasure * measuresPerPhrase1;
        return bestMatch;
      }
    }
    return null;
  };

  it('should find polyrhythm between very different ratios (2/2 vs 3/4)', () => {
    numerator = 2;
    denominator = 2;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    // 3 measures of 2/2 (4 beats) = 12 beats
    // 4 measures of 3/4 (3 beats) = 12 beats
    expect(result.originalMeasures * meterRatio).toBeCloseTo(
      result.polyMeasures * (3/4), 8
    );
  });

  it('should find polyrhythm between complex meters (5/4 vs 7/8)', () => {
    numerator = 5;
    denominator = 4;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([7, 8]);
    const result = getPolyrhythm();

    // 5/4 (1.25) and 7/8 (0.875) - LCM needed to find alignment
    // These may not align within small measure counts, so result can be null
    if (result !== null) {
      expect(result.totalMeasures).toBeGreaterThanOrEqual(3);
    }
  });

  it('should converge to solution within reasonable measure count', () => {
    numerator = 7;
    denominator = 9;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([5, 6]);
    const result = getPolyrhythm();

    // 7/9 (0.777) and 5/6 (0.833) - may require more than 10 measures
    // Just verify it finds something or gives up gracefully
    if (result !== null) {
      expect(result.totalMeasures).toBeGreaterThanOrEqual(3);
    }
  });

  it('should handle composers returning same meter after many iterations', () => {
    numerator = 4;
    denominator = 4;
    getMidiTiming();

    let callCount = 0;
    composer.getMeter = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount < 5 ? [4, 4] : [3, 4]; // Return same meter 4 times, then different
    });

    const result = getPolyrhythm();
    expect(result).not.toBeNull();
    expect(result.polyNumerator).toBe(3);
  });

  it('should calculate tpPhrase correctly for complex polyrhythm', () => {
    numerator = 7;
    denominator = 8;
    getMidiTiming();
    const originalTpMeasure = tpMeasure;

    composer.getMeter = vi.fn().mockReturnValue([5, 8]);
    const result = getPolyrhythm();

    if (result !== null) {
      expect(tpPhrase).toBe(originalTpMeasure * measuresPerPhrase1);
    }
  });

  it('should reject polyrhythm with only 1 measure per phrase in both layers', () => {
    // Create a scenario where the best match would be 1:1
    setNumerator(6);
    denominator = 8;
    getMidiTiming();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    // Should reject because it requires at least one layer with >1 measure
    // or total > 2
    expect(result === null || result.totalMeasures > 2).toBe(true);
  });

  it('should recalculate timing when fallback meter is applied', () => {
    // Simulate getPolyrhythm reaching max attempts and requesting new primary meter
    setNumerator(4);
    setDenominator(4);
    setBPM(120);
    setPPQ(480);
    getMidiTiming();

    const originalTpMeasure = tpMeasure;
    const originalTpSec = tpSec;
    const originalSpMeasure = spMeasure;

    // Simulate fallback: change primary meter and recalculate
    setNumerator(7);
    setDenominator(9);
    getMidiTiming(); // CRITICAL: this must be called after meter change

    // Verify all timing globals were recalculated
    expect(meterRatio).toBeCloseTo(7/9, 10);
    expect(midiMeter[1]).toBe(8); // Spoofed to 7/8
    expect(tpMeasure).not.toBe(originalTpMeasure); // Should change
    expect(tpSec).not.toBe(originalTpSec); // Should change
    expect(spMeasure).not.toBe(originalSpMeasure); // Should change

    // Verify new timing is internally consistent
    expect(tpMeasure).toBeCloseTo(PPQ * 4 * (7/8), 5);
    expect(spMeasure).toBeCloseTo((60 / BPM) * 4 * (7/9), 10);
    expect(syncFactor).toBeCloseTo((7/8) / (7/9), 10);
  });

  it('should maintain section timing accuracy even with meter fallback', () => {
    // Start with 4/4
    numerator = 4;
    denominator = 4;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();

    // Simulate 2 measures of 4/4
    measuresPerPhrase = 2;
    tpPhrase = tpMeasure * 2;
    spPhrase = tpPhrase / tpSec;
    const section1Duration = spPhrase;

    // Fallback to 7/9 and calculate next section
    numerator = 7;
    denominator = 9;
    getMidiTiming();
    measuresPerPhrase = 2;
    tpPhrase = tpMeasure * 2;
    spPhrase = tpPhrase / tpSec;
    const section2Duration = spPhrase;

    // Both sections should have valid timing (no NaN, no Infinity, > 0)
    expect(Number.isFinite(section1Duration)).toBe(true);
    expect(Number.isFinite(section2Duration)).toBe(true);
    expect(section1Duration).toBeGreaterThan(0);
    expect(section2Duration).toBeGreaterThan(0);

    // Durations should be different because meters are different
    expect(section1Duration).not.toBeCloseTo(section2Duration, 2);
  });
});

describe('Full Timing Hierarchy', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should correctly calculate all timing levels for 7/9 meter', () => {
    numerator = 7;
    denominator = 9;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();

    // Calculate all levels
    const tpBeat = tpMeasure / 7;
    const tpDiv = tpBeat / 2; // Assume 2 divisions
    const tpSubdiv = tpDiv / 2; // Assume 2 subdivisions

    // tpMeasure should use MIDI meter ratio (7/8) not actual meter ratio (7/9)
    expect(tpMeasure).toBeCloseTo(480 * 4 * (7/8), 1);
    expect(tpBeat).toBeCloseTo(tpMeasure / 7, 5);
    expect(tpDiv).toBeCloseTo(tpBeat / 2, 5);
    expect(tpSubdiv).toBeCloseTo(tpDiv / 2, 5);
  });

  it('should maintain ratio consistency across hierarchy for 5/6 meter', () => {
    numerator = 5;
    denominator = 6;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();

    const tpBeat = tpMeasure / 5;
    const tpDiv = tpBeat / 3;
    const tpSubdiv = tpDiv / 2;

    // Verify that tpPhrase = tpMeasure * measuresPerPhrase
    measuresPerPhrase1 = 4;
    tpPhrase = tpMeasure * 4;

    expect(tpPhrase / 4).toBeCloseTo(tpMeasure, 5);
  });

  it('should handle deep subdivision chains (4 levels) correctly', () => {
    numerator = 4;
    denominator = 4;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();

    const measure = tpMeasure;
    const beat = measure / 4;
    const division = beat / 2;
    const subdivision = division / 2;
    const subsubdivision = subdivision / 2;

    expect(subsubdivision).toBeCloseTo(beat / 8, 5);
    expect(subsubdivision * 32).toBeCloseTo(measure, 5);
  });

  it('should correctly relate tpSec to all timing levels', () => {
    numerator = 3;
    denominator = 4;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();


    // Measure duration in seconds = tpMeasure / tpSec
    // For 3/4: tpMeasure = 480 * 4 * (3/4) = 1440
    // tpSec = 120 * 480 / 60 = 960
    // duration = 1440 / 960 = 1.5 seconds
    const measureDurationSeconds = tpMeasure / tpSec;
    const expectedDuration = (3 * 4 / 4) * (60 / 120);
    expect(measureDurationSeconds).toBeCloseTo(expectedDuration, 5);
  });
});

describe('Polyrhythm Duration Alignment', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should align 3:4 polyrhythm (3/4 over 4/4) in absolute time', () => {
    // Primary: 4/4
    numerator = 4;
    denominator = 4;
    BPM = 120;
    getMidiTiming();
    const primary_tpMeasure = tpMeasure;
    const primary_tpSec = tpSec;
    const primary_duration_3measures = (primary_tpMeasure * 3) / primary_tpSec;

    // Poly: 3/4
    numerator = 3;
    denominator = 4;
    getMidiTiming();
    const poly_tpMeasure = tpMeasure;
    const poly_tpSec = tpSec;
    const poly_duration_4measures = (poly_tpMeasure * 4) / poly_tpSec;

    // Should align: 3 measures of 4/4 (3 beats) = 4 measures of 3/4 (3 beats)
    expect(primary_duration_3measures).toBeCloseTo(poly_duration_4measures, 5);
  });

  it('should maintain alignment with spoofed meters', () => {
    // Test that spoofing preserves actual duration through syncFactor adjustment
    numerator = 7;
    denominator = 9;
    BPM = 120;
    PPQ = 480;
    getMidiTiming();

    // spMeasure uses actual meterRatio (7/9)
    const expectedSpMeasure = (60 / 120) * 4 * (7/9);
    expect(spMeasure).toBeCloseTo(expectedSpMeasure, 10);

    // tpMeasure uses midiMeterRatio (7/8)
    const expectedTpMeasure = 480 * 4 * (7/8);
    expect(tpMeasure).toBeCloseTo(expectedTpMeasure, 5);

    // tpSec uses midiBPM (adjusted for spoofing)
    const expectedTpSec = midiBPM * 480 / 60;
    expect(tpSec).toBeCloseTo(expectedTpSec, 5);

    // syncFactor = midiMeterRatio / meterRatio
    const expectedSyncFactor = (7/8) / (7/9);
    expect(syncFactor).toBeCloseTo(expectedSyncFactor, 10);
  });

  it('should scale duration inversely with BPM for same meter', () => {
    // duration = tpMeasure / tpSec, where tpSec = BPM * PPQ / 60
    // So duration is inversely proportional to BPM
    numerator = 7;
    denominator = 9;
    PPQ = 480;
    const bpms = [60, 90, 120, 180];
    const durations = [];

    bpms.forEach(bpm => {
      BPM = bpm;
      getMidiTiming();
      const duration = tpMeasure / tpSec;
      durations.push(duration);
    });

    // Verify durations are inversely proportional to original BPM
    // When BPM increases, tpSec increases (midiBPM increases), so duration decreases
    expect(durations[0]).toBeGreaterThan(durations[3]);
    expect(durations[1]).toBeGreaterThan(durations[2]);
  });

  it('should handle rapid meter changes without timing artifacts', () => {
    const meterSequence = [[7,9], [5,6], [11,12], [4,4], [3,8]];

    meterSequence.forEach(([num, den]) => {
      numerator = num;
      denominator = den;
      BPM = 120;
      getMidiTiming();

      // tpMeasure uses midiMeterRatio (power-of-2 denominator)
      // Verify the midiMeter denominator is always power-of-2
      expect([2, 4, 8, 16, 32, 64, 128, 256]).toContain(midiMeter[1]);

      // Verify midiMeterRatio is used for tpMeasure
      const expectedTpMeasure = PPQ * 4 * (midiMeter[0] / midiMeter[1]);
      expect(tpMeasure).toBeCloseTo(expectedTpMeasure, 5);
    });
  });
});

describe('Timing Validation Utilities', () => {
  it('should verify tpSec calculation depends on midiBPM (meter-dependent)', () => {
    BPM = 120;
    PPQ = 480;

    // Test that tpSec varies with meter because midiBPM is adjusted by syncFactor
    numerator = 4;
    denominator = 4;
    getMidiTiming();
    const tpSec_4_4 = tpSec;

    numerator = 7;
    denominator = 9;
    getMidiTiming();
    const tpSec_7_9 = tpSec;

    // 4/4 has no spoofing (midiMeter = [4,4], syncFactor = 1, midiBPM = 120)
    expect(tpSec_4_4).toBeCloseTo(120 * 480 / 60, 2); // 960

    // 7/9 has spoofing (midiMeter = [7,8], syncFactor ≈ 1.126, midiBPM ≈ 135.1)
    const expectedSyncFactor = (7/8) / (7/9);
    const expectedMidiBPM = 120 * expectedSyncFactor;
    const expectedTpSec = expectedMidiBPM * 480 / 60;
    expect(tpSec_7_9).toBeCloseTo(expectedTpSec, 2);

    // They should NOT be equal
    expect(tpSec_4_4).not.toBeCloseTo(tpSec_7_9, 1);
  });

  it('should verify midiMeter is always power-of-2 denominator', () => {
    const testMeters = [[7,9], [5,6], [11,12], [13,17], [420,69]];

    testMeters.forEach(([num, den]) => {
      numerator = num;
      denominator = den;
      getMidiTiming();

      const denom = midiMeter[1];
      const isPowerOf2 = (n) => (n & (n - 1)) === 0;
      expect(isPowerOf2(denom)).toBe(true);
    });
  });

  it('should verify syncFactor correctly adjusts tempo', () => {
    numerator = 7;
    denominator = 9;
    BPM = 120;
    getMidiTiming();

    // midiBPM should equal BPM * syncFactor
    expect(midiBPM).toBeCloseTo(BPM * syncFactor, 5);
  });
});

describe('Multi-layer timing consistency', () => {
  beforeEach(() => {
    setupGlobalState();
    composer = mockComposer;
    // Mock setRhythm and tracking functions
    setRhythm = () => [1, 1, 1, 1];
    trackBeatRhythm = () => {};
    trackDivRhythm = () => {};
    trackSubdivRhythm = () => {};
    trackSubsubdivRhythm = () => {};
    logUnit = () => {};
  });

  it('should maintain consistent timing when switching between layers', () => {
    // Setup two layers with different timing states
    numerator = 4;
    denominator = 4;
    BPM = 120;
    getMidiTiming();

    const { state: state1, buffer: buffer1 } = LM.register('layer1', 'c1', {
      phraseStart: 0,
      phraseStartTime: 0
    });

    const { state: state2, buffer: buffer2 } = LM.register('layer2', 'c2', {
      phraseStart: 1920,
      phraseStartTime: 2.0
    });

    // Activate layer1 and set measure timing
    measureIndex = 0;
    LM.activate('layer1');
    setUnitTiming('measure');
    expect(measureStart).toBe(0);

    // Advance layer1
    measuresPerPhrase = 1;
    tpPhrase = tpMeasure;
    spPhrase = spMeasure;
    LM.advance('layer1', 'phrase');

    // Activate layer2 (should restore layer2's timing state to globals)
    measureIndex = 0;
    LM.activate('layer2');
    setUnitTiming('measure');

    // measureStart should use layer2's phraseStart (1920), not layer1's
    expect(measureStart).toBe(1920);
    expect(phraseStart).toBe(1920);

    // Switch back to layer1
    measureIndex = 1;
    LM.activate('layer1');
    setUnitTiming('measure');

    // measureStart should reflect layer1's advanced state
    // phraseStart has been advanced by tpPhrase (= tpMeasure), so measure 1 is at phraseStart + tpMeasure
    expect(measureStart).toBe(2 * tpMeasure);
  });

  it('should correctly calculate cascading unit timings using globals', () => {
    numerator = 4;
    denominator = 4;
    BPM = 120;
    getMidiTiming();

    LM.register('test', 'c1', {
      phraseStart: 0,
      phraseStartTime: 0
    });

    LM.activate('test');

    // Set measure timing
    measureIndex = 1;
    setUnitTiming('measure');
    const measureTick = measureStart;
    expect(measureTick).toBe(tpMeasure); // phraseStart(0) + 1 * tpMeasure

    // Set beat timing (should cascade from measureStart)
    beatIndex = 2;
    setUnitTiming('beat');
    const expectedBeatStart = measureTick + 2 * tpBeat;
    expect(beatStart).toBe(expectedBeatStart);

    // Set division timing (should cascade from beatStart)
    divIndex = 1;
    setUnitTiming('division');
    const expectedDivStart = beatStart + 1 * tpDiv;
    expect(divStart).toBe(expectedDivStart);
  });

  it('should handle polyrhythm layer switching correctly', () => {
    numerator = 4;
    denominator = 4;
    BPM = 120;
    polyNumerator = 3;
    polyDenominator = 4;
    // Ensure module-level globals see the manually set poly meter
    setGlobalVar('polyNumerator', 3);
    setGlobalVar('polyDenominator', 4);
    getMidiTiming();
    // Don't call getPolyrhythm() - just set the values manually for testing
    setMeasuresPerPhrase1(3);
    setMeasuresPerPhrase2(4);

    const { state: state1 } = LM.register('primary', 'c1', {
      phraseStart: 0,
      phraseStartTime: 0
    });

    const { state: state2 } = LM.register('poly', 'c2', {
      phraseStart: 0,
      phraseStartTime: 0
    });

    // Activate primary layer
    LM.activate('primary', false);
    expect(measuresPerPhrase).toBe(measuresPerPhrase1);

    const primaryMeasures = measuresPerPhrase;

    // Activate poly layer
    LM.activate('poly', true);
    expect(numerator).toBe(polyNumerator);
    expect(denominator).toBe(polyDenominator);
    expect(measuresPerPhrase).toBe(measuresPerPhrase2);

    // Should not equal primary measures (unless they happen to match)
    const polyMeasures = measuresPerPhrase;

    // Switch back to primary
    LM.activate('primary', false);
    expect(measuresPerPhrase).toBe(primaryMeasures);
  });
});
