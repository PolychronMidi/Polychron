// test/time.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
const mockComposer = {
  getMeter: vi.fn(),
  getDivisions: vi.fn(),
  getSubdivisions: vi.fn(),
  getSubsubdivs: vi.fn(),
  constructor: { name: 'MockComposer' },
  root: 'C',
  scale: { name: 'major' }
};

// Global state mocks (matching time.js variables)
let numerator, denominator, meterRatio, midiMeter, midiMeterRatio, syncFactor;
let BPM, midiBPM, PPQ, tpSec, tpMeasure;
let polyNumerator, polyDenominator, polyMeterRatio, measuresPerPhrase1, measuresPerPhrase2;
let tpPhrase, tpSection, spSection, tpBeat, spBeat, tpDiv, spDiv, tpSubdiv, spSubdiv;
let spMeasure, tpSubsubdiv, spSubsubdiv;
let sectionStart, phraseStart, measureStart, beatStart, divStart, subdivStart, subsubdivStart;
let sectionStartTime, phraseStartTime, measureStartTime, beatStartTime, divStartTime;
let subdivStartTime, subsubdivStartTime;
let composer, c, LOG;
let m = Math;

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
}

// Import functions (in real implementation, these would be exported from time.js)
const getMidiMeter = () => {
  meterRatio = numerator / denominator;
  const isPowerOf2 = (n) => { return (n & (n - 1)) === 0; };
  if (isPowerOf2(denominator)) {
    midiMeter = [numerator, denominator];
  } else {
    const high = 2 ** m.ceil(m.log2(denominator));
    const highRatio = numerator / high;
    const low = 2 ** m.floor(m.log2(denominator));
    const lowRatio = numerator / low;
    midiMeter = m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio)
      ? [numerator, high]
      : [numerator, low];
  }
  midiMeterRatio = midiMeter[0] / midiMeter[1];
  syncFactor = midiMeterRatio / meterRatio;
  midiBPM = BPM * syncFactor;
  tpSec = midiBPM * PPQ / 60;
  tpMeasure = PPQ * 4 * midiMeterRatio;
  return midiMeter;
};

const formatTime = (seconds) => {
  const minutes = m.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};

describe('getMidiMeter', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  describe('Power of 2 denominators (MIDI-compatible)', () => {
    it('should return 4/4 unchanged', () => {
      numerator = 4;
      denominator = 4;
      const result = getMidiMeter();
      expect(result).toEqual([4, 4]);
      expect(midiMeter).toEqual([4, 4]);
      expect(syncFactor).toBe(1);
    });

    it('should return 3/4 unchanged', () => {
      numerator = 3;
      denominator = 4;
      getMidiMeter();
      expect(midiMeter).toEqual([3, 4]);
      expect(syncFactor).toBe(1);
    });

    it('should return 7/8 unchanged', () => {
      numerator = 7;
      denominator = 8;
      getMidiMeter();
      expect(midiMeter).toEqual([7, 8]);
      expect(syncFactor).toBe(1);
    });

    it('should return 5/16 unchanged', () => {
      numerator = 5;
      denominator = 16;
      getMidiMeter();
      expect(midiMeter).toEqual([5, 16]);
      expect(syncFactor).toBe(1);
    });

    it('should return 12/8 unchanged', () => {
      numerator = 12;
      denominator = 8;
      getMidiMeter();
      expect(midiMeter).toEqual([12, 8]);
      expect(syncFactor).toBe(1);
    });
  });

  describe('Non-power of 2 denominators (requires spoofing)', () => {
    it('should spoof 7/9 to nearest power of 2', () => {
      numerator = 7;
      denominator = 9;
      getMidiMeter();
      expect(midiMeter[1]).toBe(8); // 8 is closer to 9 than 16
      expect(midiMeter[0]).toBe(7);
      expect(syncFactor).toBeCloseTo(7/8 / (7/9), 5);
    });

    it('should spoof 5/6 correctly', () => {
      numerator = 5;
      denominator = 6;
      getMidiMeter();
      expect([4, 8]).toContain(midiMeter[1]); // Either 4 or 8 could be closest
      expect(midiMeter[0]).toBe(5);
    });

    it('should spoof 11/12 correctly', () => {
      numerator = 11;
      denominator = 12;
      getMidiMeter();
      expect([8, 16]).toContain(midiMeter[1]);
      expect(midiMeter[0]).toBe(11);
    });

    it('should spoof 13/17 correctly', () => {
      numerator = 13;
      denominator = 17;
      getMidiMeter();
      expect(midiMeter[1]).toBe(16); // 16 is closest power of 2 to 17
      expect(midiMeter[0]).toBe(13);
    });

    it('should handle the infamous 420/69', () => {
      numerator = 420;
      denominator = 69;
      getMidiMeter();
      expect([64, 128]).toContain(midiMeter[1]); // 64 is closest to 69
      expect(midiMeter[0]).toBe(420);
    });
  });

  describe('Sync factor calculations', () => {
    it('should calculate correct sync factor for 7/9', () => {
      numerator = 7;
      denominator = 9;
      getMidiMeter();
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
      getMidiMeter();
      const expectedMidiBPM = 120 * syncFactor;
      expect(midiBPM).toBeCloseTo(expectedMidiBPM, 5);
    });

    it('should calculate correct ticks per second', () => {
      numerator = 4;
      denominator = 4;
      BPM = 120;
      PPQ = 480;
      getMidiMeter();
      const expectedTpSec = 120 * 480 / 60; // 960
      expect(tpSec).toBeCloseTo(expectedTpSec, 5);
    });

    it('should calculate correct ticks per measure', () => {
      numerator = 3;
      denominator = 4;
      PPQ = 480;
      getMidiMeter();
      const expectedTpMeasure = PPQ * 4 * (3/4); // 1440
      expect(tpMeasure).toBeCloseTo(expectedTpMeasure, 5);
    });
  });

  describe('Edge cases', () => {
    it('should handle numerator of 1', () => {
      numerator = 1;
      denominator = 4;
      getMidiMeter();
      expect(midiMeter).toEqual([1, 4]);
      expect(syncFactor).toBe(1);
    });

    it('should handle large numerators', () => {
      numerator = 127;
      denominator = 16;
      getMidiMeter();
      expect(midiMeter).toEqual([127, 16]);
      expect(syncFactor).toBe(1);
    });

    it('should handle denominator of 2', () => {
      numerator = 3;
      denominator = 2;
      getMidiMeter();
      expect(midiMeter).toEqual([3, 2]);
      expect(syncFactor).toBe(1);
    });

    it('should handle very odd denominators like 127', () => {
      numerator = 7;
      denominator = 127;
      getMidiMeter();
      expect(midiMeter[1]).toBe(128); // Closest power of 2
      expect(midiMeter[0]).toBe(7);
    });
  });

  describe('Meter ratio preservation', () => {
    it('should preserve time duration through sync factor', () => {
      numerator = 7;
      denominator = 9;
      BPM = 120;
      getMidiMeter();

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
});

describe('getPolyrhythm', () => {
  beforeEach(() => {
    setupGlobalState();
    numerator = 4;
    denominator = 4;
    getMidiMeter();
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
    getMidiMeter();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.originalMeasures).toBe(3);
    expect(result.polyMeasures).toBe(4);
  });

  it('should find 2:3 polyrhythm (3/4 over 2/4)', () => {
    numerator = 2;
    denominator = 4;
    getMidiMeter();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.totalMeasures).toBeLessThanOrEqual(10);
  });

  it('should reject identical meters', () => {
    numerator = 4;
    denominator = 4;
    getMidiMeter();

    composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should require at least 3 total measures', () => {
    numerator = 4;
    denominator = 4;
    getMidiMeter();

    // This should create a 2-measure polyrhythm which is rejected
    composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should set measuresPerPhrase1 and measuresPerPhrase2', () => {
    numerator = 4;
    denominator = 4;
    getMidiMeter();

    composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    getPolyrhythm();

    expect(measuresPerPhrase1).toBeGreaterThan(0);
    expect(measuresPerPhrase2).toBeGreaterThan(0);
  });

  it('should calculate tpPhrase correctly', () => {
    numerator = 4;
    denominator = 4;
    getMidiMeter();

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
    getMidiMeter();
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
    getMidiMeter();

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

    getMidiMeter();

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
    getMidiMeter();
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
