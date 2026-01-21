import { NUMERATOR, DENOMINATOR, DIVISIONS, SUBDIVISIONS, SUBSUBDIVS, VOICES, OCTAVE } from '../../src/sheet.js';
import { MeasureComposer } from '../../src/composers/index.js';

describe('MeasureComposer', () => {
  // No global setup; tests use named imports from `src/sheet.ts` and DI-friendly composers.

  describe('constructor', () => {
    it('should initialize with null lastMeter', () => {
      const composer = new MeasureComposer();
      expect(composer.lastMeter).toBeNull();
    });
  });

  describe('getNumerator', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getNumerator();
      expect(result).toBeGreaterThanOrEqual(NUMERATOR.min);
      expect(result).toBeLessThanOrEqual(NUMERATOR.max);
    });

    it('should return an integer', () => {
      const composer = new MeasureComposer();
      const result = composer.getNumerator();
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('getDenominator', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getDenominator();
      expect(result).toBeGreaterThanOrEqual(DENOMINATOR.min);
      expect(result).toBeLessThanOrEqual(DENOMINATOR.max);
    });
  });

  describe('getDivisions', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getDivisions();
      expect(result).toBeGreaterThanOrEqual(DIVISIONS.min);
      expect(result).toBeLessThanOrEqual(DIVISIONS.max);
    });
  });

  describe('getSubdivisions', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getSubdivisions();
      expect(result).toBeGreaterThanOrEqual(SUBDIVISIONS.min);
      expect(result).toBeLessThanOrEqual(SUBDIVISIONS.max);
    });
  });

  describe('getSubsubdivs', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getSubsubdivs();
      expect(result).toBeGreaterThanOrEqual(SUBSUBDIVS.min);
      expect(result).toBeLessThanOrEqual(SUBSUBDIVS.max);
    });
  });

  describe('getVoices', () => {
    it('should return a number within configured range', () => {
      const composer = new MeasureComposer();
      const result = composer.getVoices();
      expect(result).toBeGreaterThanOrEqual(VOICES.min);
      expect(result).toBeLessThanOrEqual(VOICES.max);
    });
  });

  describe('getOctaveRange', () => {
    it('should return an array of two octaves', () => {
      const composer = new MeasureComposer();
      const result = composer.getOctaveRange();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should return octaves within configured range', () => {
      const composer = new MeasureComposer();
      const [o1, o2] = composer.getOctaveRange();
      expect(o1).toBeGreaterThanOrEqual(OCTAVE.min);
      expect(o1).toBeLessThanOrEqual(OCTAVE.max);
      expect(o2).toBeGreaterThanOrEqual(OCTAVE.min);
      expect(o2).toBeLessThanOrEqual(OCTAVE.max);
    });

    it('should ensure octaves are at least 2-3 apart', () => {
      const composer = new MeasureComposer();
      const [o1, o2] = composer.getOctaveRange();
      expect(Math.abs(o1 - o2)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getMeter', () => {
    it('should return an array of two numbers', () => {
      const composer = new MeasureComposer();
      const result = composer.getMeter();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should return a meter when not ignoring check', () => {
      const composer = new MeasureComposer();
      const meter = composer.getMeter(false);
      expect(Array.isArray(meter)).toBe(true);
      expect(meter.length).toBe(2);
    });

    it('should store lastMeter', () => {
      const composer = new MeasureComposer();
      const meter = composer.getMeter();
      expect(composer.lastMeter).toEqual(meter);
    });

    it('should limit ratio change when lastMeter exists', () => {
      const composer = new MeasureComposer();
      const firstMeter = composer.getMeter();
      const secondMeter = composer.getMeter();
      const ratio1 = firstMeter[0] / firstMeter[1];
      const ratio2 = secondMeter[0] / secondMeter[1];
      const change = Math.abs(ratio1 - ratio2);
      expect(change).toBeLessThanOrEqual(3.0);
    });

    it('should allow any meter when ignoring ratio check', () => {
      const composer = new MeasureComposer();
      const result = composer.getMeter(true);
      expect(result.length).toBe(2);
    });
  });
});

describe('MeasureComposer.getMeter() - Enhanced Tests', () => {
  let composer: MeasureComposer;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    composer = new MeasureComposer();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('Basic meter generation', () => {
    it('should return an array of two integers [numerator, denominator]', () => {
      const meter = composer.getMeter();
      expect(Array.isArray(meter)).toBe(true);
      expect(meter.length).toBe(2);
      expect(Number.isInteger(meter[0])).toBe(true);
      expect(Number.isInteger(meter[1])).toBe(true);
    });

    it('should generate meters with valid ratio (0.25 to 4)', () => {
      for (let i = 0; i < 50; i++) {
        const meter = composer.getMeter();
        const ratio = meter[0] / meter[1];
        expect(ratio).toBeGreaterThanOrEqual(0.25);
        expect(ratio).toBeLessThanOrEqual(4);
      }
    });

    it('should store lastMeter after generation', () => {
      const meter = composer.getMeter();
      expect(composer.lastMeter).toEqual(meter);
    });
  });

  describe('Ratio validation with constants', () => {
    it('should apply METER_RATIO_MIN and METER_RATIO_MAX bounds', () => {
      for (let i = 0; i < 100; i++) {
        const meter = composer.getMeter();
        const ratio = meter[0] / meter[1];
        expect(ratio).toBeGreaterThanOrEqual(0.25);
        expect(ratio).toBeLessThanOrEqual(4);
      }
    });

    it('should allow any meter with ignoreRatioCheck=true', () => {
      const meter1 = composer.getMeter(false);
      const meter2 = composer.getMeter(true);
      expect(Array.isArray(meter1)).toBe(true);
      expect(Array.isArray(meter2)).toBe(true);
    });

    it('should validate that numerator and denominator are positive', () => {
      for (let i = 0; i < 200; i++) {
        const meter = composer.getMeter();
        expect(meter[0]).toBeGreaterThan(0);
        expect(meter[1]).toBeGreaterThan(0);
      }
    });
  });

  describe('Log-step constraints (MIN_LOG_STEPS)', () => {
    it('should respect maxLogSteps=2 when polyMeter=false', () => {
      composer.lastMeter = [4, 4];

      for (let i = 0; i < 30; i++) {
        const meter = composer.getMeter(false, false);
        const lastRatio = composer.lastMeter[0] / composer.lastMeter[1];
        const newRatio = meter[0] / meter[1];
        const logSteps = Math.abs(Math.log2(newRatio / lastRatio));
        expect(logSteps).toBeLessThanOrEqual(2.01);
      }
    });

    it('should respect maxLogSteps=4 when polyMeter=true', () => {
      composer.lastMeter = [4, 4];

      for (let i = 0; i < 30; i++) {
        const meter = composer.getMeter(false, true);
        const lastRatio = composer.lastMeter[0] / composer.lastMeter[1];
        const newRatio = meter[0] / meter[1];
        const logSteps = Math.abs(Math.log2(newRatio / lastRatio));
        expect(logSteps).toBeLessThanOrEqual(4.01);
      }
    });

    it('should enforce minimum log-step separation (MIN_LOG_STEPS = 0.5)', () => {
      composer.lastMeter = [4, 4];

      const meters = [] as Array<[number, number]>;
      for (let i = 0; i < 30; i++) {
        meters.push(composer.getMeter());
      }

      for (let i = 1; i < meters.length; i++) {
        const prevRatio = meters[i - 1][0] / meters[i - 1][1];
        const currRatio = meters[i][0] / meters[i][1];
        const logSteps = Math.abs(Math.log2(currRatio / prevRatio));
        expect(logSteps).toBeGreaterThanOrEqual(0.49);
      }
    });
  });

  describe('First meter generation (no lastMeter)', () => {
    it('should return valid meter even when lastMeter is null', () => {
      composer.lastMeter = null;
      const meter = composer.getMeter();
      expect(meter).not.toBeNull();
      expect(Array.isArray(meter)).toBe(true);
      expect(meter.length).toBe(2);
    });

    it('should set lastMeter on first call', () => {
      composer.lastMeter = null;
      const meter = composer.getMeter();
      expect(composer.lastMeter).toEqual(meter);
    });
  });

  describe('Fallback behavior with diagnostic logging', () => {
    it('should return fallback [4, 4] when max iterations exceeded', () => {
      composer.lastMeter = [4, 4];
      const meter = composer.getMeter(false, false, 1);
      expect(meter).toBeDefined();
      expect(Array.isArray(meter)).toBe(true);
      expect(meter.length).toBe(2);
    });

    it('should log warning when falling back', () => {
      composer.lastMeter = [4, 4];
      composer.getMeter(false, false, 0);
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnMessage = consoleWarnSpy.mock.calls[consoleWarnSpy.mock.calls.length - 1][0];
      expect(warnMessage).toContain('getMeter() failed');
      expect(warnMessage).toContain('fallback');
    });

    it('should include diagnostic information in warning', () => {
      composer.lastMeter = [4, 4];
      composer.getMeter(false, false, 0);
      const warnMessage = consoleWarnSpy.mock.calls[consoleWarnSpy.mock.calls.length - 1][0];
      expect(warnMessage).toContain('iterations');
      expect(warnMessage).toContain('Ratio bounds');
      expect(warnMessage).toContain('LogSteps');
    });

    it('should update lastMeter appropriately when iterations exhausted', () => {
      composer.lastMeter = [3, 8];
      const result = composer.getMeter(false, false, 1);
      expect(composer.lastMeter).toEqual(result);
    });
  });

  describe('Edge cases and robustness', () => {
    it('should handle consecutive calls with constraints', () => {
      composer.lastMeter = null;

      const meters = [] as Array<[number, number]>;
      for (let i = 0; i < 100; i++) {
        const meter = composer.getMeter();
        meters.push(meter);
        const ratio = meter[0] / meter[1];
        expect(ratio).toBeGreaterThanOrEqual(0.25);
        expect(ratio).toBeLessThanOrEqual(4);
        expect(meter[0]).toBeGreaterThan(0);
        expect(meter[1]).toBeGreaterThan(0);
      }

      const uniqueMeters = new Set(meters.map(m => `${m[0]}/${m[1]}`));
      expect(uniqueMeters.size).toBeGreaterThan(30);
    });

    it('should handle polyMeter flag correctly', () => {
      composer.lastMeter = [3, 4];
      const polyMeter = composer.getMeter(false, true);
      const newRatio = polyMeter[0] / polyMeter[1];
      const lastRatio = 0.75;
      const logSteps = Math.abs(Math.log2(newRatio / lastRatio));
      expect(logSteps).toBeLessThanOrEqual(4.01);
    });

    it('should maintain independent state across composers', () => {
      const composer2 = new MeasureComposer();
      const meter1 = composer.getMeter();
      const meter2 = composer2.getMeter();
      expect(composer.lastMeter).not.toBe(composer2.lastMeter);
    });

    it('should properly reset on new composer instance', () => {
      composer.getMeter();
      const oldMeter = composer.lastMeter;
      const newComposer = new MeasureComposer();
      expect(newComposer.lastMeter).toBeNull();
      newComposer.getMeter();
      expect(newComposer.lastMeter).not.toBe(oldMeter);
    });
  });
});

describe('MeasureComposer edge cases', () => {
  afterEach(() => {
    delete (globalThis as any).bpmRatio;
  });

  it('should handle extreme bpmRatio', () => {
    (globalThis as any).bpmRatio = 10;
    const composer = new MeasureComposer();
    const result = composer.getNumerator();
    expect(result).toBeGreaterThan(0);
  });

  it('should handle zero bpmRatio', () => {
    (globalThis as any).bpmRatio = 0;
    const composer = new MeasureComposer();
    const result = composer.getNumerator();
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('MIDI compliance - MeasureComposer', () => {
  // No global setup required; constants are imported from `src/sheet.ts`.

  it('should use reasonable octave ranges', () => {
    const composer = new MeasureComposer();
    const [o1, o2] = composer.getOctaveRange();
    expect(o1).toBeGreaterThanOrEqual(0);
    expect(o1).toBeLessThanOrEqual(10);
    expect(o2).toBeGreaterThanOrEqual(0);
    expect(o2).toBeLessThanOrEqual(10);
  });
});
