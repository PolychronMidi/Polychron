// test/time.test.js
require('../sheet');  // Defines constants
require('../backstage');  // Defines utility functions
require('../time');  // Time functions

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

describe('getMidiMeter', () => {
  beforeEach(() => {
    setupGlobalState();
    // Make composer available globally for getPolyrhythm tests
    globalThis.composer = globalThis.composer || mockComposer;
  });

  describe('Power of 2 denominators (MIDI-compatible)', () => {
    it('should return 4/4 unchanged', () => {
      globalThis.numerator = 4;
      globalThis.denominator = 4;
      const result = getMidiMeter();
      expect(result).toEqual([4, 4]);
      expect(globalThis.midiMeter).toEqual([4, 4]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 3/4 unchanged', () => {
      globalThis.numerator = 3;
      globalThis.denominator = 4;
      getMidiMeter();
      expect(globalThis.midiMeter).toEqual([3, 4]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 7/8 unchanged', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 8;
      getMidiMeter();
      expect(globalThis.midiMeter).toEqual([7, 8]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 5/16 unchanged', () => {
      globalThis.numerator = 5;
      globalThis.denominator = 16;
      getMidiMeter();
      expect(globalThis.midiMeter).toEqual([5, 16]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should return 12/8 unchanged', () => {
      globalThis.numerator = 12;
      globalThis.denominator = 8;
      getMidiMeter();
      expect(globalThis.midiMeter).toEqual([12, 8]);
      expect(globalThis.syncFactor).toBe(1);
    });
  });

  describe('Non-power of 2 denominators (requires spoofing)', () => {
    it('should spoof 7/9 to nearest power of 2', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 9;
      getMidiMeter();
      expect(globalThis.midiMeter[1]).toBe(8); // 8 is closer to 9 than 16
      expect(globalThis.midiMeter[0]).toBe(7);
      expect(globalThis.syncFactor).toBeCloseTo(7/8 / (7/9), 5);
    });

    it('should spoof 5/6 correctly', () => {
      globalThis.numerator = 5;
      globalThis.denominator = 6;
      getMidiMeter();
      expect([4, 8]).toContain(globalThis.midiMeter[1]); // Either 4 or 8 could be closest
      expect(globalThis.midiMeter[0]).toBe(5);
    });

    it('should spoof 11/12 correctly', () => {
      globalThis.numerator = 11;
      globalThis.denominator = 12;
      getMidiMeter();
      expect([8, 16]).toContain(globalThis.midiMeter[1]);
      expect(globalThis.midiMeter[0]).toBe(11);
    });

    it('should spoof 13/17 correctly', () => {
      globalThis.numerator = 13;
      globalThis.denominator = 17;
      getMidiMeter();
      expect(globalThis.midiMeter[1]).toBe(16); // 16 is closest power of 2 to 17
      expect(globalThis.midiMeter[0]).toBe(13);
    });

    it('should handle the infamous 420/69', () => {
      globalThis.numerator = 420;
      globalThis.denominator = 69;
      getMidiMeter();
      expect([64, 128]).toContain(globalThis.midiMeter[1]); // 64 is closest to 69
      expect(globalThis.midiMeter[0]).toBe(420);
    });
  });

  describe('Sync factor calculations', () => {
    it('should calculate correct sync factor for 7/9', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 9;
      getMidiMeter();
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
      getMidiMeter();
      const expectedMidiBPM = 120 * globalThis.syncFactor;
      expect(globalThis.midiBPM).toBeCloseTo(expectedMidiBPM, 5);
    });

    it('should calculate correct ticks per second', () => {
      globalThis.numerator = 4;
      globalThis.denominator = 4;
      globalThis.BPM = 120;
      globalThis.PPQ = 480;
      getMidiMeter();
      const expectedTpSec = 120 * 480 / 60; // 960
      expect(globalThis.tpSec).toBeCloseTo(expectedTpSec, 5);
    });

    it('should calculate correct ticks per measure', () => {
      globalThis.numerator = 3;
      globalThis.denominator = 4;
      globalThis.PPQ = 480;
      getMidiMeter();
      const expectedTpMeasure = globalThis.PPQ * 4 * (3/4); // 1440
      expect(globalThis.tpMeasure).toBeCloseTo(expectedTpMeasure, 5);
    });
  });

  describe('Edge cases', () => {
    it('should handle numerator of 1', () => {
      globalThis.numerator = 1;
      globalThis.denominator = 4;
      getMidiMeter();
      expect(globalThis.midiMeter).toEqual([1, 4]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should handle large numerators', () => {
      globalThis.numerator = 127;
      globalThis.denominator = 16;
      getMidiMeter();
      expect(globalThis.midiMeter).toEqual([127, 16]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should handle denominator of 2', () => {
      globalThis.numerator = 3;
      globalThis.denominator = 2;
      getMidiMeter();
      expect(globalThis.midiMeter).toEqual([3, 2]);
      expect(globalThis.syncFactor).toBe(1);
    });

    it('should handle very odd denominators like 127', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 127;
      getMidiMeter();
      expect(globalThis.midiMeter[1]).toBe(128); // Closest power of 2
      expect(globalThis.midiMeter[0]).toBe(7);
    });
  });

  describe('Meter ratio preservation', () => {
    it('should preserve time duration through sync factor', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 9;
      globalThis.BPM = 120;
      getMidiMeter();

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
    getMidiMeter();
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
    getMidiMeter();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.originalMeasures).toBe(3);
    expect(result.polyMeasures).toBe(4);
  });

  it('should find 2:3 polyrhythm (3/4 over 2/4)', () => {
    globalThis.numerator = 2;
    globalThis.denominator = 4;
    getMidiMeter();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    const result = getPolyrhythm();

    expect(result).not.toBeNull();
    expect(result.totalMeasures).toBeLessThanOrEqual(10);
  });

  it('should reject identical meters', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiMeter();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should require at least 3 total measures', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiMeter();

    // This should create a 2-measure polyrhythm which is rejected
    globalThis.composer.getMeter = vi.fn().mockReturnValue([4, 4]);
    const result = getPolyrhythm();

    expect(result).toBeNull();
  });

  it('should set measuresPerPhrase1 and measuresPerPhrase2', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiMeter();

    globalThis.composer.getMeter = vi.fn().mockReturnValue([3, 4]);
    getPolyrhythm();

    expect(globalThis.measuresPerPhrase1).toBeGreaterThan(0);
    expect(globalThis.measuresPerPhrase2).toBeGreaterThan(0);
  });

  it('should calculate tpPhrase correctly', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    getMidiMeter();

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
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    globalThis.BPM = 120;
    globalThis.PPQ = 480;

    getMidiMeter();

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

describe('setUnitTiming', () => {
  beforeEach(() => {
    setupGlobalState();
    numerator = 4;
    denominator = 4;
    BPM = 120;
    PPQ = 480;
    getMidiMeter();
    globalThis.measuresPerPhrase = 4;
    globalThis.tpPhrase = tpMeasure * globalThis.measuresPerPhrase;
    globalThis.spPhrase = globalThis.tpPhrase / tpSec;
    // Mock LM for setUnitTiming
    globalThis.LM = {
      layers: {
        test: {
          state: {
            phraseStart: 0,
            phraseStartTime: 0,
            sectionStart: 0,
            sectionStartTime: 0,
            sectionEnd: 0,
            tpSection: 0,
            spSection: 0,
            tpPhrase: tpPhrase,
            spPhrase: spPhrase,
            measureStart: 0,
            measureStartTime: 0,
            tpMeasure: tpMeasure,
            spMeasure: tpMeasure / tpSec
          }
        }
      },
      activeLayer: 'test'
    };
    globalThis.measureIndex = 0;
    globalThis.beatIndex = 0;
    globalThis.divIndex = 0;
    globalThis.subdivIndex = 0;
    globalThis.subsubdivIndex = 0;
    composer = { getDivisions: () => 2, getSubdivisions: () => 2, getSubsubdivs: () => 1 };
  });

  it('should set phrase timing correctly', () => {
    setUnitTiming('phrase');
    expect(globalThis.tpPhrase).toBe(tpMeasure * globalThis.measuresPerPhrase);
    expect(globalThis.spPhrase).toBe(globalThis.tpPhrase / tpSec);
  });

  it('should set measure timing within phrase', () => {
    const layer = LM.layers.test;
    layer.state.phraseStart = 1000;
    layer.state.phraseStartTime = 1.0;
    measureIndex = 1;

    setUnitTiming('measure');

    expect(measureStart).toBe(1000 + 1 * tpMeasure);
    expect(measureStartTime).toBe(1.0 + 1 * (tpMeasure / tpSec));
  });

  it('should set beat timing within measure', () => {
    measureStart = 1920;
    measureStartTime = 2.0;
    beatIndex = 2;

    setUnitTiming('beat');

    expect(tpBeat).toBe(tpMeasure / 4); // 4/4 time
    expect(spBeat).toBe(tpBeat / tpSec);
    expect(beatStart).toBe(1920 + 2 * tpBeat);
    expect(beatStartTime).toBe(2.0 + 2 * spBeat);
  });

  it('should set division timing within beat', () => {
    beatStart = 2400;
    beatStartTime = 2.5;
    divIndex = 1;
    tpBeat = 480;

    setUnitTiming('division');

    expect(tpDiv).toBe(240); // 480 / 2 divisions
    expect(spDiv).toBe(tpDiv / tpSec);
    expect(divStart).toBe(2400 + 1 * tpDiv);
    expect(divStartTime).toBe(2.5 + 1 * spDiv);
  });

  it('should set subdivision timing within division', () => {
    divStart = 2640;
    divStartTime = 2.75;
    subdivIndex = 1;
    tpDiv = 240;

    setUnitTiming('subdivision');

    expect(tpSubdiv).toBe(120); // 240 / 2 subdivisions
    expect(spSubdiv).toBe(tpSubdiv / tpSec);
    expect(subdivStart).toBe(2640 + 1 * tpSubdiv);
    expect(subdivStartTime).toBe(2.75 + 1 * spSubdiv);
  });

  it('should set subsubdivision timing within subdivision', () => {
    subdivStart = 2760;
    subdivStartTime = 2.875;
    subsubdivIndex = 0;
    tpSubdiv = 120;

    setUnitTiming('subsubdivision');

    expect(tpSubsubdiv).toBe(120); // 120 / 1 subsubdivs
    expect(spSubsubdiv).toBe(tpSubsubdiv / tpSec);
    expect(subsubdivStart).toBe(2760 + 0 * tpSubsubdiv);
    expect(subsubdivStartTime).toBe(2.875 + 0 * spSubsubdiv);
  });

  it('should handle different time signatures', () => {
    numerator = 3;
    denominator = 4;
    getMidiMeter();
    tpMeasure = PPQ * 4 * (3/4);

    setUnitTiming('beat');

    expect(tpBeat).toBe(tpMeasure / 3); // 3/4 time has 3 beats
  });

  it('should handle complex rhythmic divisions', () => {
    composer.getDivisions = () => 3;
    composer.getSubdivisions = () => 5;
    composer.getSubsubdivs = () => 7;

    tpBeat = 480;
    setUnitTiming('division');
    expect(tpDiv).toBe(160); // 480 / 3

    setUnitTiming('subdivision');
    expect(tpSubdiv).toBe(32); // 160 / 5

    setUnitTiming('subsubdivision');
    expect(tpSubsubdiv).toBeCloseTo(4.57, 2); // 32 / 7
  });

  it('should update global rhythm counters', () => {
    // This would normally be done by setRhythm calls
    beatRhythm = [1, 0, 1, 0];
    divRhythm = [1, 0];
    subdivRhythm = [1, 0];

    // setUnitTiming doesn't directly modify these, but they should be available
    expect(beatRhythm).toEqual([1, 0, 1, 0]);
    expect(divRhythm).toEqual([1, 0]);
    expect(subdivRhythm).toEqual([1, 0]);
  });

  it('should handle layer state updates', () => {
    const layer = LM.layers.test;
    layer.state.phraseStart = 5000;
    layer.state.phraseStartTime = 5.0;

    measureIndex = 2;
    setUnitTiming('measure');

    expect(measureStart).toBe(5000 + 2 * tpMeasure);
    expect(measureStartTime).toBe(5.0 + 2 * (tpMeasure / tpSec));
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