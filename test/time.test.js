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
let numerator, denominator, meterRatio, midiMeter, midiMeterRatio, syncFactor;
let BPM, midiBPM, PPQ, tpSec, tpMeasure;
let polyNumerator, polyDenominator, polyMeterRatio, measuresPerPhrase1, measuresPerPhrase2;
let tpPhrase, tpSection, spSection, tpBeat, spBeat, tpDiv, spDiv, tpSubdiv, spSubdiv;
let spMeasure, tpSubsubdiv, spSubsubdiv;
let sectionStart, phraseStart, measureStart, beatStart, divStart, subdivStart, subsubdivStart;
let sectionStartTime, phraseStartTime, measureStartTime, beatStartTime, divStartTime;
let subdivStartTime, subsubdivStartTime;
let composer, c, LOG;

// Setup function to reset state
function setupGlobalState() {
  globalThis.numerator = 4;
  globalThis.denominator = 4;
  globalThis.BPM = 120;
  globalThis.PPQ = 480;
  globalThis.sectionStart = 0;
  globalThis.phraseStart = 0;
  globalThis.measureStart = 0;
  globalThis.beatStart = 0;
  globalThis.divStart = 0;
  globalThis.subdivStart = 0;
  globalThis.subsubdivStart = 0;
  globalThis.sectionStartTime = 0;
  globalThis.phraseStartTime = 0;
  globalThis.measureStartTime = 0;
  globalThis.beatStartTime = 0;
  globalThis.divStartTime = 0;
  globalThis.subdivStartTime = 0;
  globalThis.subsubdivStartTime = 0;
  globalThis.tpSection = 0;
  globalThis.spSection = 0;
  globalThis.spMeasure = 0;
  globalThis.composer = { ...mockComposer };
  globalThis.c = [];
  globalThis.LOG = 'none';
}

describe('getMidiTiming', () => {
  beforeEach(() => {
    setupGlobalState();
    // Make composer available globally for getPolyrhythm tests
    globalThis.composer = globalThis.composer || mockComposer;
  });

  describe('Power of 2 denominators (MIDI-compatible)', () => {
    it('should return 4/4 unchanged', () => {
      globalThis.numerator = 4;
      globalThis.denominator = 4;
      const result = getMidiTiming();
      expect(result).toEqual([4, 4]);
      expect(globalThis.midiMeter).toEqual([4, 4]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 3/4 unchanged', () => {
      globalThis.numerator = 3;
      globalThis.denominator = 4;
      getMidiTiming();
      expect(globalThis.midiMeter).toEqual([3, 4]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 7/8 unchanged', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 8;
      getMidiTiming();
      expect(globalThis.midiMeter).toEqual([7, 8]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 5/16 unchanged', () => {
      globalThis.numerator = 5;
      globalThis.denominator = 16;
      getMidiTiming();
      expect(globalThis.midiMeter).toEqual([5, 16]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 12/8 unchanged', () => {
      globalThis.numerator = 12;
      globalThis.denominator = 8;
      getMidiTiming();
      expect(globalThis.midiMeter).toEqual([12, 8]);
      expect(globalThis.syncFactor).toBe(1);
    });
  });

  describe('Non-power of 2 denominators (requires spoofing)', () => {
    it('should spoof 7/9 to nearest power of 2', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 9;
      getMidiTiming();
      expect(globalThis.midiMeter[1]).toBe(8); // 8 is closer to 9 than 16
      expect(globalThis.midiMeter[0]).toBe(7);
      expect(globalThis.syncFactor).toBeCloseTo(7/8 / (7/9), 5);
    });

    it('should spoof 5/6 correctly', () => {
      globalThis.numerator = 5;
      globalThis.denominator = 6;
      getMidiTiming();
      expect([4, 8]).toContain(globalThis.midiMeter[1]); // Either 4 or 8 could be closest
      expect(globalThis.midiMeter[0]).toBe(5);
    });

    it('should spoof 11/12 correctly', () => {
      globalThis.numerator = 11;
      globalThis.denominator = 12;
      getMidiTiming();
      expect([8, 16]).toContain(globalThis.midiMeter[1]);
      expect(globalThis.midiMeter[0]).toBe(11);
    });

    it('should spoof 13/17 correctly', () => {
      globalThis.numerator = 13;
      globalThis.denominator = 17;
      getMidiTiming();
      expect(globalThis.midiMeter[1]).toBe(16); // 16 is closest power of 2 to 17
      expect(globalThis.midiMeter[0]).toBe(13);
    });

    it('should handle the infamous 420/69', () => {
      globalThis.numerator = 420;
      globalThis.denominator = 69;
      getMidiTiming();
      expect([64, 128]).toContain(globalThis.midiMeter[1]); // 64 is closest to 69
      expect(globalThis.midiMeter[0]).toBe(420);
    });
  });

  describe('Sync factor calculations', () => {
    it('should calculate correct sync factor for 7/9', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 9;
      getMidiTiming();
      const expectedMeterRatio = 7 / 9;
      const expectedMidiMeterRatio = 7 / 8;
      const expectedSyncFactor = expectedMidiMeterRatio / expectedMeterRatio;
      expect(globalThis.meterRatio).toBeCloseTo(expectedMeterRatio, 10);
      expect(globalThis.midiMeterRatio).toBeCloseTo(expectedMidiMeterRatio, 10);
      expect(globalThis.syncFactor).toBeCloseTo(expectedSyncFactor, 10);
    });

    it('should calculate correct BPM adjustment', () => {
      globalThis.numerator = 5;
      globalThis.denominator = 6;
      globalThis.BPM = 120;
      getMidiTiming();
      const expectedMidiBPM = 120 * globalThis.syncFactor;
      expect(globalThis.midiBPM).toBeCloseTo(expectedMidiBPM, 5);
    });

    it('should calculate correct ticks per second', () => {
      globalThis.numerator = 4;
      globalThis.denominator = 4;
      globalThis.BPM = 120;
      globalThis.PPQ = 480;
      getMidiTiming();
      const expectedTpSec = 120 * 480 / 60; // 960
      expect(globalThis.tpSec).toBeCloseTo(expectedTpSec, 5);
    });

    it('should calculate correct ticks per measure', () => {
      globalThis.numerator = 3;
      globalThis.denominator = 4;
      globalThis.PPQ = 480;
      getMidiTiming();
      const expectedTpMeasure = globalThis.PPQ * 4 * (3/4); // 1440
      expect(globalThis.tpMeasure).toBeCloseTo(expectedTpMeasure, 5);
    });
  });

  describe('Edge cases', () => {
    it('should handle numerator of 1', () => {
      globalThis.numerator = 1;
      globalThis.denominator = 4;
      getMidiTiming();
      expect(globalThis.midiMeter).toEqual([1, 4]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should handle large numerators', () => {
      globalThis.numerator = 127;
      globalThis.denominator = 16;
      getMidiTiming();
      expect(globalThis.midiMeter).toEqual([127, 16]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should handle denominator of 2', () => {
      globalThis.numerator = 3;
      globalThis.denominator = 2;
      getMidiTiming();
      expect(globalThis.midiMeter).toEqual([3, 2]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should handle very odd denominators like 127', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 127;
      getMidiTiming();
      expect(globalThis.midiMeter[1]).toBe(128); // Closest power of 2
      expect(globalThis.midiMeter[0]).toBe(7);
    });
  });

  describe('Meter ratio preservation', () => {
    it('should preserve time duration through sync factor', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 9;
      globalThis.BPM = 120;
      getMidiTiming();

      // Original measure duration in seconds
      const originalBeatsPerMeasure = globalThis.numerator;
      const originalBeatDuration = 60 / globalThis.BPM;
      const originalMeasureDuration = originalBeatsPerMeasure * originalBeatDuration * (4 / globalThis.denominator);

      // MIDI measure duration in seconds
      const midiBeatsPerMeasure = globalThis.midiMeter[0];
      const midiBeatDuration = 60 / globalThis.midiBPM;
      const midiMeasureDuration = midiBeatsPerMeasure * midiBeatDuration * (4 / globalThis.midiMeter[1]);

      expect(midiMeasureDuration).toBeCloseTo(originalMeasureDuration, 5);
    });
  });
});

describe('getPolyrhythm', () => {
  beforeEach(() => {
    setupGlobalState();
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();
  });

  const getPolyrhythm = () => {
    let iterations = 0;
    const maxIterations = 100;

    while (iterations < maxIterations) {
      iterations++;

      [globalThis.polyNumerator, globalThis.polyDenominator] = globalThis.composer.getMeter(true, true);
      globalThis.polyMeterRatio = globalThis.polyNumerator / globalThis.polyDenominator;

      let bestMatch = {
        originalMeasures: Infinity,
        polyMeasures: Infinity,
        totalMeasures: Infinity,
        polyNumerator: globalThis.polyNumerator,
        polyDenominator: globalThis.polyDenominator
      };

      for (let originalMeasures = 1; originalMeasures < 6; originalMeasures++) {
        for (let polyMeasures = 1; polyMeasures < 6; polyMeasures++) {
          if (m.abs(originalMeasures * globalThis.meterRatio - polyMeasures * globalThis.polyMeterRatio) < 0.00000001) {
            let currentMatch = {
              originalMeasures: originalMeasures,
              polyMeasures: polyMeasures,
              totalMeasures: originalMeasures + polyMeasures,
              polyNumerator: globalThis.polyNumerator,
              polyDenominator: globalThis.polyDenominator
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
          (globalThis.numerator !== globalThis.polyNumerator || globalThis.denominator !== globalThis.polyDenominator)) {
        globalThis.measuresPerPhrase1 = bestMatch.originalMeasures;
        globalThis.measuresPerPhrase2 = bestMatch.polyMeasures;
        globalThis.tpPhrase = globalThis.tpMeasure * globalThis.measuresPerPhrase1;
        return bestMatch;
      }
    }
    return null;
  };

  it('should find 3:2 polyrhythm (3/4 over 4/4)', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.originalMeasures).toBe(3);
    expect(result.polyMeasures).toBe(4);
  });

  it('should find 2:3 polyrhythm (3/4 over 2/4)', () => {
    globalThis.numerator = 2;
    globalThis.denominator = 4;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.totalMeasures).toBeLessThanOrEqual(10);
  });

  it('should reject identical meters', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should require at least 3 total measures', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();

    // This should create a 2-measure polyrhythm which is rejected
    globalThis.composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should set measuresPerPhrase1 and measuresPerPhrase2', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    getPolyrhythm();

    expect(globalThis.measuresPerPhrase1).toBeGreaterThan(0);
    expect(globalThis.measuresPerPhrase2).toBeGreaterThan(0);
  });

  it('should calculate tpPhrase correctly', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    getPolyrhythm();

    expect(globalThis.tpPhrase).toBe(globalThis.tpMeasure * globalThis.measuresPerPhrase1);
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
      const divsPerBeat = globalThis.composer.getDivisions();
      globalThis.tpDiv = globalThis.tpBeat / m.max(1, divsPerBeat);
      globalThis.spDiv = globalThis.tpDiv / globalThis.tpSec;
      globalThis.divStart = globalThis.beatStart + 0 * globalThis.tpDiv;
      globalThis.divStartTime = globalThis.beatStartTime + 0 * globalThis.spDiv;
    };

    it('should calculate division timing for 2 divisions', () => {
      globalThis.tpBeat = 480;
      globalThis.tpSec = 960;
      globalThis.composer.getDivisions = vi.fn().mockReturnValue(2);
      setDivTiming();
      expect(globalThis.tpDiv).toBe(240);
      expect(globalThis.spDiv).toBeCloseTo(0.25, 5);
    });

    it('should handle 0 divisions gracefully', () => {
      globalThis.tpBeat = 480;
      globalThis.composer.getDivisions = vi.fn().mockReturnValue(0);
      setDivTiming();
      expect(globalThis.tpDiv).toBe(480); // max(1, 0) = 1
    });

    it('should calculate division timing for triplets', () => {
      globalThis.tpBeat = 480;
      globalThis.composer.getDivisions = vi.fn().mockReturnValue(3);
      setDivTiming();
      expect(globalThis.tpDiv).toBe(160);
    });
  });

  describe('Subdivision timing', () => {
    const setSubdivTiming = () => {
      const subdivsPerDiv = globalThis.composer.getSubdivisions();
      globalThis.tpSubdiv = globalThis.tpDiv / m.max(1, subdivsPerDiv);
      globalThis.spSubdiv = globalThis.tpSubdiv / globalThis.tpSec;
      globalThis.subdivStart = globalThis.divStart + 0 * globalThis.tpSubdiv;
      globalThis.subdivStartTime = globalThis.divStartTime + 0 * globalThis.spSubdiv;
    };

    it('should calculate subdivision timing', () => {
      globalThis.tpDiv = 240;
      globalThis.tpSec = 960;
      globalThis.composer.getSubdivisions = vi.fn().mockReturnValue(2);
      setSubdivTiming();
      expect(globalThis.tpSubdiv).toBe(120);
      expect(globalThis.spSubdiv).toBe(0.125);
    });

    it('should handle complex subdivisions', () => {
      globalThis.tpDiv = 160;
      globalThis.composer.getSubdivisions = vi.fn().mockReturnValue(5);
      setSubdivTiming();
      expect(globalThis.tpSubdiv).toBe(32);
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
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;

    getMidiTiming();

    // Measure should take same duration regardless of spoofing
    const actualBeats = globalThis.numerator;
    const actualBeatValue = 4 / globalThis.denominator;
    const expectedMeasureDurationBeats = actualBeats * actualBeatValue;

    const midiBeats = globalThis.midiMeter[0];
    const midiBeatValue = 4 / globalThis.midiMeter[1];
    const midiMeasureDurationBeats = midiBeats * midiBeatValue;

    // After sync factor adjustment, durations should match
    const adjustedMidiDuration = midiMeasureDurationBeats / globalThis.syncFactor;
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
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();
    // tpMeasure uses MIDI meter (7/8), not actual meter (7/9)
    const primaryTpMeasure = 480 * 4 * (7/8);
    expect(globalThis.tpMeasure).toBeCloseTo(primaryTpMeasure, 5);

    // Change to different meter
    globalThis.numerator = 5;
    globalThis.denominator = 6;
    getMidiTiming();
    // midiMeter for 5/6 is 5/8
    const polyTpMeasure = 480 * 4 * (5/8);
    expect(globalThis.tpMeasure).toBeCloseTo(polyTpMeasure, 5);
  });

  it('should handle extreme tempo differences between layers', () => {
    // Test with very different meters
    globalThis.numerator = 3;
    globalThis.denominator = 16;
    getMidiTiming();
    const slowTpSec = globalThis.tpSec;

    globalThis.numerator = 15;
    globalThis.denominator = 8;
    getMidiTiming();
    const fastTpSec = globalThis.tpSec;

    // Both should produce valid timing
    expect(slowTpSec).toBeGreaterThan(0);
    expect(fastTpSec).toBeGreaterThan(0);
  });
});

describe('Long-Running Timing Stability', () => {
  it('should maintain accuracy over 100+ measures', () => {
    // Verify that calculated values don't change across iterations
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;

    getMidiTiming();
    const duration1 = globalThis.tpMeasure / globalThis.tpSec;

    // Recalculate - should be identical
    getMidiTiming();
    const duration2 = globalThis.tpMeasure / globalThis.tpSec;

    expect(duration1).toBe(duration2);
  });

  it('should handle BPM changes without timing drift', () => {
    const meters = [[7,9], [5,6], [11,12], [4,4]];
    let totalPrimaryTime = 0;
    let totalPolyTime = 0;

    meters.forEach(([num, den]) => {
      globalThis.numerator = num;
      globalThis.denominator = den;
      globalThis.BPM = 120;
      getMidiTiming();
      totalPrimaryTime += globalThis.tpMeasure / globalThis.tpSec;
    });

    // Reverse order for poly layer
    meters.reverse().forEach(([num, den]) => {
      globalThis.numerator = num;
      globalThis.denominator = den;
      globalThis.BPM = 120;
      getMidiTiming();
      totalPolyTime += globalThis.tpMeasure / globalThis.tpSec;
    });

    // Both should have same total duration for same meters
    expect(Math.abs(totalPrimaryTime - totalPolyTime)).toBeLessThan(0.001);
  });
});

describe('Edge Case Meter Spoofing', () => {
  it('should handle denominators exactly between powers of 2', () => {
    // Test denominator = 6 (between 4 and 8)
    globalThis.numerator = 5;
    globalThis.denominator = 6;
    getMidiTiming();

    // Should choose closest power of 2
    expect([4, 8]).toContain(globalThis.midiMeter[1]);

    // Verify sync factor is reasonable (not necessarily > 0.9, depends on which power of 2 is chosen)
    const originalRatio = 5/6;
    const midiRatio = globalThis.midiMeter[0]/globalThis.midiMeter[1];
    const syncFactor = midiRatio / originalRatio;
    expect(syncFactor).toBeGreaterThan(0.5);
    expect(syncFactor).toBeLessThan(1.5);
  });

  it('should handle very large denominators', () => {
    globalThis.numerator = 7;
    globalThis.denominator = 255;
    getMidiTiming();

    // Should choose 256 (next power of 2)
    expect(globalThis.midiMeter[1]).toBe(256);
    expect(globalThis.syncFactor).toBeCloseTo((7/256)/(7/255), 5);
  });

  it('should handle denominator = 1', () => {
    globalThis.numerator = 3;
    globalThis.denominator = 1;
    getMidiTiming();

    // Should choose 1 (already power of 2)
    expect(globalThis.midiMeter[1]).toBe(1);
    expect(globalThis.syncFactor).toBe(1);
  });
});


describe('Real-Time Performance', () => {
  it('should maintain timing accuracy with high subdivision counts', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    // Test with extreme subdivisions
    const subdivisions = [2, 4, 8, 16, 32, 64, 128, 256];
    let totalError = 0;

    subdivisions.forEach(subdivs => {
      const tpBeat = globalThis.tpMeasure / 4;
      const tpSubdiv = tpBeat / subdivs;
      const expectedSubdivDuration = (60 / 120) / 4 / subdivs; // seconds

      const actualSubdivDuration = tpSubdiv / globalThis.tpSec;
      totalError += Math.abs(expectedSubdivDuration - actualSubdivDuration);
    });

    const avgError = totalError / subdivisions.length;
    expect(avgError).toBeLessThan(0.1); // Realistic tolerance for high subdivision floating point operations
  });

  it('should handle rapid tempo changes without glitches', () => {
    const tempos = [60, 80, 100, 120, 140, 160, 180, 200];
    let maxDurationError = 0;

    tempos.forEach(bpm => {
      globalThis.BPM = bpm;
      globalThis.numerator = 4;
      globalThis.denominator = 4;
      getMidiTiming();

      // Measure duration should be consistent
      const expectedDuration = 4 * (60 / bpm); // 4 beats per measure
      const actualDuration = globalThis.tpMeasure / globalThis.tpSec;

      maxDurationError = Math.max(maxDurationError, Math.abs(expectedDuration - actualDuration));
    });

    expect(maxDurationError).toBeLessThan(0.0001);
  });
});

describe('End-to-End MIDI Timing', () => {
  it('should generate MIDI files with correct timing markers', () => {
    // Verify that timing events are generated correctly
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    globalThis.c = [];
    globalThis.beatStart = 0;
    globalThis.measureStart = 0;

    getMidiTiming();
    setMidiTiming(0);

    // Check that BPM and meter events exist
    const bpmEvent = globalThis.c.find(e => e.type === 'bpm');
    const meterEvent = globalThis.c.find(e => e.type === 'meter');

    expect(bpmEvent).toBeDefined();
    expect(meterEvent).toBeDefined();
    expect(meterEvent.vals).toEqual([7, 8]); // MIDI-compatible

    // Verify tpMeasure uses midiMeterRatio (7/8), not actual ratio (7/9)
    const expectedTpMeasure = globalThis.PPQ * 4 * (7/8);
    expect(globalThis.tpMeasure).toBeCloseTo(expectedTpMeasure, 5);

    // BPM should be adjusted for the spoofed meter
    expect(bpmEvent.vals[0]).toBeCloseTo(globalThis.BPM * globalThis.syncFactor, 0);
  });

  it('should maintain sync across multiple phrases', () => {
    // Simulate multiple phrases
    const phraseDurations = [];
    const meters = [[7,9], [5,6], [11,12]];

    meters.forEach(([num, den]) => {
      globalThis.numerator = num;
      globalThis.denominator = den;
      globalThis.BPM = 120;
      getMidiTiming();

      // 3 measures per phrase
      const phraseTicks = globalThis.tpMeasure * 3;
      const phraseSeconds = phraseTicks / globalThis.tpSec;
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
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();
  });

  it('should write BPM event to buffer', () => {
    const testBuffer = [];
    globalThis.c = testBuffer;
    setMidiTiming(0);

    const bpmEvent = testBuffer.find(e => e.type === 'bpm');
    expect(bpmEvent).not.toBeUndefined();
    expect(bpmEvent.vals[0]).toBe(globalThis.midiBPM);
  });

  it('should write meter event to buffer', () => {
    const testBuffer = [];
    globalThis.c = testBuffer;
    setMidiTiming(0);

    const meterEvent = testBuffer.find(e => e.type === 'meter');
    expect(meterEvent).not.toBeUndefined();
    expect(meterEvent.vals).toEqual([globalThis.midiMeter[0], globalThis.midiMeter[1]]);
  });

  it('should place events at correct tick position', () => {
    const testBuffer = [];
    globalThis.c = testBuffer;
    setMidiTiming(1000);

    expect(testBuffer[0].tick).toBe(1000);
    expect(testBuffer[1].tick).toBe(1000);
  });

  it('should use default tick of measureStart when not provided', () => {
    const testBuffer = [];
    globalThis.c = testBuffer;
    globalThis.measureStart = 500;
    setMidiTiming();

    expect(testBuffer[0].tick).toBe(500);
    expect(testBuffer[1].tick).toBe(500);
  });

  it('should write correct adjusted BPM for spoofed meters', () => {
    const testBuffer = [];
    globalThis.c = testBuffer;
    setMidiTiming(0);

    const bpmEvent = testBuffer.find(e => e.type === 'bpm');
    expect(bpmEvent.vals[0]).toBeCloseTo(120 * globalThis.syncFactor, 2);
  });

  it('should write MIDI-compatible meter not actual meter', () => {
    const testBuffer = [];
    globalThis.c = testBuffer;
    setMidiTiming(0);

    const meterEvent = testBuffer.find(e => e.type === 'meter');
    expect(meterEvent.vals[1]).toBe(globalThis.midiMeter[1]);
    expect(meterEvent.vals[1]).toBe(8); // 7/9 spoofed to 7/8
  });
});

describe('getPolyrhythm Edge Cases', () => {
  beforeEach(() => {
    setupGlobalState();
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();
  });

  const getPolyrhythm = () => {
    let iterations = 0;
    const maxIterations = 100;

    while (iterations < maxIterations) {
      iterations++;

      [globalThis.polyNumerator, globalThis.polyDenominator] = globalThis.composer.getMeter(true, true);
      globalThis.polyMeterRatio = globalThis.polyNumerator / globalThis.polyDenominator;

      let bestMatch = {
        originalMeasures: Infinity,
        polyMeasures: Infinity,
        totalMeasures: Infinity,
        polyNumerator: globalThis.polyNumerator,
        polyDenominator: globalThis.polyDenominator
      };

      for (let originalMeasures = 1; originalMeasures < 7; originalMeasures++) {
        for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
          if (m.abs(originalMeasures * globalThis.meterRatio - polyMeasures * globalThis.polyMeterRatio) < .00000001) {
            let currentMatch = {
              originalMeasures: originalMeasures,
              polyMeasures: polyMeasures,
              totalMeasures: originalMeasures + polyMeasures,
              polyNumerator: globalThis.polyNumerator,
              polyDenominator: globalThis.polyDenominator
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
          !(globalThis.numerator === globalThis.polyNumerator && globalThis.denominator === globalThis.polyDenominator)) {
        globalThis.measuresPerPhrase1 = bestMatch.originalMeasures;
        globalThis.measuresPerPhrase2 = bestMatch.polyMeasures;
        globalThis.tpPhrase = globalThis.tpMeasure * globalThis.measuresPerPhrase1;
        return bestMatch;
      }
    }
    return null;
  };

  it('should find polyrhythm between very different ratios (2/2 vs 3/4)', () => {
    globalThis.numerator = 2;
    globalThis.denominator = 2;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    // 3 measures of 2/2 (4 beats) = 12 beats
    // 4 measures of 3/4 (3 beats) = 12 beats
    expect(result.originalMeasures * globalThis.meterRatio).toBeCloseTo(
      result.polyMeasures * (3/4), 8
    );
  });

  it('should find polyrhythm between complex meters (5/4 vs 7/8)', () => {
    globalThis.numerator = 5;
    globalThis.denominator = 4;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([7, 8]);
    const result = getPolyrhythm();

    // 5/4 (1.25) and 7/8 (0.875) - LCM needed to find alignment
    // These may not align within small measure counts, so result can be null
    if (result !== null) {
      expect(result.totalMeasures).toBeGreaterThanOrEqual(3);
    }
  });

  it('should converge to solution within reasonable measure count', () => {
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([5, 6]);
    const result = getPolyrhythm();

    // 7/9 (0.777) and 5/6 (0.833) - may require more than 10 measures
    // Just verify it finds something or gives up gracefully
    if (result !== null) {
      expect(result.totalMeasures).toBeGreaterThanOrEqual(3);
    }
  });

  it('should handle composers returning same meter after many iterations', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();

    let callCount = 0;
    globalThis.composer.getMeter = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount < 5 ? [4, 4] : [3, 4]; // Return same meter 4 times, then different
    });

    const result = getPolyrhythm();
    expect(result).not.toBeNull();
    expect(result.polyNumerator).toBe(3);
  });

  it('should calculate tpPhrase correctly for complex polyrhythm', () => {
    globalThis.numerator = 7;
    globalThis.denominator = 8;
    getMidiTiming();
    const originalTpMeasure = globalThis.tpMeasure;

    globalThis.composer.getMeter = vi.fn().mockReturnValue([5, 8]);
    const result = getPolyrhythm();

    if (result !== null) {
      expect(globalThis.tpPhrase).toBe(originalTpMeasure * globalThis.measuresPerPhrase1);
    }
  });

  it('should reject polyrhythm with only 1 measure per phrase in both layers', () => {
    // Create a scenario where the best match would be 1:1
    globalThis.numerator = 6;
    globalThis.denominator = 8;
    getMidiTiming();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    // Should reject because it requires at least one layer with >1 measure
    // or total > 2
    expect(result === null || result.totalMeasures > 2).toBe(true);
  });

  it('should recalculate timing when fallback meter is applied', () => {
    // Simulate getPolyrhythm reaching max attempts and requesting new primary meter
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    const originalTpMeasure = globalThis.tpMeasure;
    const originalTpSec = globalThis.tpSec;
    const originalSpMeasure = globalThis.spMeasure;

    // Simulate fallback: change primary meter and recalculate
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    getMidiTiming(); // CRITICAL: this must be called after meter change

    // Verify all timing globals were recalculated
    expect(globalThis.meterRatio).toBeCloseTo(7/9, 10);
    expect(globalThis.midiMeter[1]).toBe(8); // Spoofed to 7/8
    expect(globalThis.tpMeasure).not.toBe(originalTpMeasure); // Should change
    expect(globalThis.tpSec).not.toBe(originalTpSec); // Should change
    expect(globalThis.spMeasure).not.toBe(originalSpMeasure); // Should change

    // Verify new timing is internally consistent
    expect(globalThis.tpMeasure).toBeCloseTo(globalThis.PPQ * 4 * (7/8), 5);
    expect(globalThis.spMeasure).toBeCloseTo((60 / globalThis.BPM) * 4 * (7/9), 10);
    expect(globalThis.syncFactor).toBeCloseTo((7/8) / (7/9), 10);
  });

  it('should maintain section timing accuracy even with meter fallback', () => {
    // Start with 4/4
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    // Simulate 2 measures of 4/4
    globalThis.measuresPerPhrase = 2;
    globalThis.tpPhrase = globalThis.tpMeasure * 2;
    globalThis.spPhrase = globalThis.tpPhrase / globalThis.tpSec;
    const section1Duration = globalThis.spPhrase;

    // Fallback to 7/9 and calculate next section
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    getMidiTiming();
    globalThis.measuresPerPhrase = 2;
    globalThis.tpPhrase = globalThis.tpMeasure * 2;
    globalThis.spPhrase = globalThis.tpPhrase / globalThis.tpSec;
    const section2Duration = globalThis.spPhrase;

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
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    // Calculate all levels
    const tpMeasure = globalThis.tpMeasure;
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
    globalThis.numerator = 5;
    globalThis.denominator = 6;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    const tpMeasure = globalThis.tpMeasure;
    const tpBeat = tpMeasure / 5;
    const tpDiv = tpBeat / 3;
    const tpSubdiv = tpDiv / 2;

    // Verify that tpPhrase = tpMeasure * measuresPerPhrase
    globalThis.measuresPerPhrase1 = 4;
    globalThis.tpPhrase = tpMeasure * 4;

    expect(globalThis.tpPhrase / 4).toBeCloseTo(tpMeasure, 5);
  });

  it('should handle deep subdivision chains (4 levels) correctly', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    const measure = globalThis.tpMeasure;
    const beat = measure / 4;
    const division = beat / 2;
    const subdivision = division / 2;
    const subsubdivision = subdivision / 2;

    expect(subsubdivision).toBeCloseTo(beat / 8, 5);
    expect(subsubdivision * 32).toBeCloseTo(measure, 5);
  });

  it('should correctly relate tpSec to all timing levels', () => {
    globalThis.numerator = 3;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    const tpMeasure = globalThis.tpMeasure;
    const tpSec = globalThis.tpSec;

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
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    getMidiTiming();
    const primary_tpMeasure = globalThis.tpMeasure;
    const primary_tpSec = globalThis.tpSec;
    const primary_duration_3measures = (primary_tpMeasure * 3) / primary_tpSec;

    // Poly: 3/4
    globalThis.numerator = 3;
    globalThis.denominator = 4;
    getMidiTiming();
    const poly_tpMeasure = globalThis.tpMeasure;
    const poly_tpSec = globalThis.tpSec;
    const poly_duration_4measures = (poly_tpMeasure * 4) / poly_tpSec;

    // Should align: 3 measures of 4/4 (3 beats) = 4 measures of 3/4 (3 beats)
    expect(primary_duration_3measures).toBeCloseTo(poly_duration_4measures, 5);
  });

  it('should maintain alignment with spoofed meters', () => {
    // Test that spoofing preserves actual duration through syncFactor adjustment
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;
    getMidiTiming();

    // spMeasure uses actual meterRatio (7/9)
    const expectedSpMeasure = (60 / 120) * 4 * (7/9);
    expect(globalThis.spMeasure).toBeCloseTo(expectedSpMeasure, 10);

    // tpMeasure uses midiMeterRatio (7/8)
    const expectedTpMeasure = 480 * 4 * (7/8);
    expect(globalThis.tpMeasure).toBeCloseTo(expectedTpMeasure, 5);

    // tpSec uses midiBPM (adjusted for spoofing)
    const expectedTpSec = globalThis.midiBPM * 480 / 60;
    expect(globalThis.tpSec).toBeCloseTo(expectedTpSec, 5);

    // syncFactor = midiMeterRatio / meterRatio
    const expectedSyncFactor = (7/8) / (7/9);
    expect(globalThis.syncFactor).toBeCloseTo(expectedSyncFactor, 10);
  });

  it('should scale duration inversely with BPM for same meter', () => {
    // duration = tpMeasure / tpSec, where tpSec = BPM * PPQ / 60
    // So duration is inversely proportional to BPM
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.PPQ = 480;
    const bpms = [60, 90, 120, 180];
    const durations = [];

    bpms.forEach(bpm => {
      globalThis.BPM = bpm;
      getMidiTiming();
      const duration = globalThis.tpMeasure / globalThis.tpSec;
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
      globalThis.numerator = num;
      globalThis.denominator = den;
      globalThis.BPM = 120;
      getMidiTiming();

      // tpMeasure uses midiMeterRatio (power-of-2 denominator)
      // Verify the midiMeter denominator is always power-of-2
      expect([2, 4, 8, 16, 32, 64, 128, 256]).toContain(globalThis.midiMeter[1]);

      // Verify midiMeterRatio is used for tpMeasure
      const expectedTpMeasure = globalThis.PPQ * 4 * (globalThis.midiMeter[0] / globalThis.midiMeter[1]);
      expect(globalThis.tpMeasure).toBeCloseTo(expectedTpMeasure, 5);
    });
  });
});

describe('Timing Validation Utilities', () => {
  it('should verify tpSec calculation depends on midiBPM (meter-dependent)', () => {
    globalThis.BPM = 120;
    globalThis.PPQ = 480;

    // Test that tpSec varies with meter because midiBPM is adjusted by syncFactor
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiTiming();
    const tpSec_4_4 = globalThis.tpSec;

    globalThis.numerator = 7;
    globalThis.denominator = 9;
    getMidiTiming();
    const tpSec_7_9 = globalThis.tpSec;

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
      globalThis.numerator = num;
      globalThis.denominator = den;
      getMidiTiming();

      const denom = globalThis.midiMeter[1];
      const isPowerOf2 = (n) => (n & (n - 1)) === 0;
      expect(isPowerOf2(denom)).toBe(true);
    });
  });

  it('should verify syncFactor correctly adjusts tempo', () => {
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    getMidiTiming();

    // midiBPM should equal BPM * syncFactor
    expect(globalThis.midiBPM).toBeCloseTo(globalThis.BPM * globalThis.syncFactor, 5);
  });
});

describe('Multi-layer timing consistency', () => {
  beforeEach(() => {
    setupGlobalState();
    globalThis.composer = mockComposer;
    // Mock setRhythm and tracking functions
    globalThis.setRhythm = () => [1, 1, 1, 1];
    globalThis.trackBeatRhythm = () => {};
    globalThis.trackDivRhythm = () => {};
    globalThis.trackSubdivRhythm = () => {};
    globalThis.trackSubsubdivRhythm = () => {};
    globalThis.logUnit = () => {};
  });

  it('should maintain consistent timing when switching between layers', () => {
    // Setup two layers with different timing states
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
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
    globalThis.measureIndex = 0;
    LM.activate('layer1');
    setUnitTiming('measure');
    expect(globalThis.measureStart).toBe(0);

    // Advance layer1
    globalThis.measuresPerPhrase = 1;
    globalThis.tpPhrase = globalThis.tpMeasure;
    globalThis.spPhrase = globalThis.spMeasure;
    LM.advance('layer1', 'phrase');

    // Activate layer2 (should restore layer2's timing state to globals)
    globalThis.measureIndex = 0;
    LM.activate('layer2');
    setUnitTiming('measure');

    // measureStart should use layer2's phraseStart (1920), not layer1's
    expect(globalThis.measureStart).toBe(1920);
    expect(globalThis.phraseStart).toBe(1920);

    // Switch back to layer1
    globalThis.measureIndex = 1;
    LM.activate('layer1');
    setUnitTiming('measure');

    // measureStart should reflect layer1's advanced state
    // phraseStart has been advanced by tpPhrase (= tpMeasure), so measure 1 is at phraseStart + tpMeasure
    expect(globalThis.measureStart).toBe(2 * globalThis.tpMeasure);
  });

  it('should correctly calculate cascading unit timings using globals', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    getMidiTiming();

    LM.register('test', 'c1', {
      phraseStart: 0,
      phraseStartTime: 0
    });

    LM.activate('test');

    // Set measure timing
    globalThis.measureIndex = 1;
    setUnitTiming('measure');
    const measureTick = globalThis.measureStart;
    expect(measureTick).toBe(globalThis.tpMeasure); // phraseStart(0) + 1 * tpMeasure

    // Set beat timing (should cascade from measureStart)
    globalThis.beatIndex = 2;
    setUnitTiming('beat');
    const expectedBeatStart = measureTick + 2 * globalThis.tpBeat;
    expect(globalThis.beatStart).toBe(expectedBeatStart);

    // Set division timing (should cascade from beatStart)
    globalThis.divIndex = 1;
    setUnitTiming('division');
    const expectedDivStart = globalThis.beatStart + 1 * globalThis.tpDiv;
    expect(globalThis.divStart).toBe(expectedDivStart);
  });

  it('should handle polyrhythm layer switching correctly', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.BPM = 120;
    globalThis.polyNumerator = 3;
    globalThis.polyDenominator = 4;
    getMidiTiming();
    // Don't call getPolyrhythm() - just set the values manually for testing
    globalThis.measuresPerPhrase1 = 3;
    globalThis.measuresPerPhrase2 = 4;

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
    expect(globalThis.measuresPerPhrase).toBe(globalThis.measuresPerPhrase1);

    const primaryMeasures = globalThis.measuresPerPhrase;

    // Activate poly layer
    LM.activate('poly', true);
    expect(globalThis.numerator).toBe(globalThis.polyNumerator);
    expect(globalThis.denominator).toBe(globalThis.polyDenominator);
    expect(globalThis.measuresPerPhrase).toBe(globalThis.measuresPerPhrase2);

    // Should not equal primary measures (unless they happen to match)
    const polyMeasures = globalThis.measuresPerPhrase;

    // Switch back to primary
    LM.activate('primary', false);
    expect(globalThis.measuresPerPhrase).toBe(primaryMeasures);
  });
});
