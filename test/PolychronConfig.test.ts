import { describe, it, expect, beforeEach } from 'vitest';
import { PolychronConfig, DEFAULT_CONFIG, validateConfig, loadConfig, getConfig, setConfig, resetConfig } from '../src/PolychronConfig';

describe('PolychronConfig', () => {
  beforeEach(() => resetConfig());

  describe('DEFAULT_CONFIG validation', () => {
    it('should have DEFAULT_CONFIG defined', () => {
      expect(DEFAULT_CONFIG).toBeDefined();
    });

    it('should have all config sections defined', () => {
      expect(DEFAULT_CONFIG.primaryInstrument).toBeDefined();
      expect(DEFAULT_CONFIG.bpm).toBeDefined();
      expect(DEFAULT_CONFIG.ppq).toBeDefined();
      expect(DEFAULT_CONFIG.tuningFreq).toBeDefined();
      expect(DEFAULT_CONFIG.composers).toBeDefined();
      expect(DEFAULT_CONFIG.sectionTypes).toBeDefined();
    });

    it('should have valid numeric values in DEFAULT_CONFIG', () => {
      expect(typeof DEFAULT_CONFIG.bpm).toBe('number');
      expect(typeof DEFAULT_CONFIG.ppq).toBe('number');
      expect(typeof DEFAULT_CONFIG.tuningFreq).toBe('number');
      expect(typeof DEFAULT_CONFIG.silentOutroSeconds).toBe('number');
    });

    it('should have valid arrays in DEFAULT_CONFIG', () => {
      expect(Array.isArray(DEFAULT_CONFIG.composers)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.sectionTypes)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.otherInstruments)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.drumSets)).toBe(true);
    });
  });

  describe('validateConfig()', () => {
    it('should reject ppq below minimum', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, ppq: 50 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('ppq'))).toBe(true);
    });

    it('should reject ppq above maximum', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, ppq: 2000000 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('ppq'))).toBe(true);
    });

    it('should reject bpm below minimum', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, bpm: 10 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('bpm'))).toBe(true);
    });

    it('should reject bpm above maximum', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, bpm: 400 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('bpm'))).toBe(true);
    });

    it('should reject tuningFreq below minimum', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, tuningFreq: 20 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('tuningFreq'))).toBe(true);
    });

    it('should reject tuningFreq above maximum', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, tuningFreq: 3000 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('tuningFreq'))).toBe(true);
    });

    it('should reject when binaural.min >= binaural.max', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, binaural: { min: 15, max: 10 } };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('binaural'))).toBe(true);
    });

    it('should reject when binaural.max is out of range', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, binaural: { min: 1, max: 50 } };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('binaural'))).toBe(true);
    });

    it('should reject negative range minimums', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, numerator: { min: -1, max: 20 } };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('numerator'))).toBe(true);
    });

    it('should reject when range max < min', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, denominator: { min: 20, max: 3 } };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('denominator'))).toBe(true);
    });

    it('should reject negative silentOutroSeconds', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, silentOutroSeconds: -1 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('silentOutroSeconds'))).toBe(true);
    });

    it('should reject silentOutroSeconds > 60', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, silentOutroSeconds: 100 };
      const errors = validateConfig(config);
      expect(errors.some(e => e.includes('silentOutroSeconds'))).toBe(true);
    });

    it('should detect multiple errors', () => {
      const config: PolychronConfig = { ...DEFAULT_CONFIG, bpm: 10, ppq: 50, tuningFreq: 20 };
      const errors = validateConfig(config);
      expect(errors.length).toBeGreaterThan(1);
    });
  });

  describe('loadConfig()', () => {
    it('should return a configuration object', () => {
      const config = loadConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('should return independent copy', () => {
      const config1 = loadConfig();
      const config2 = loadConfig();
      expect(config1).not.toBe(config2);
    });

    it('should have expected properties', () => {
      const config = loadConfig();
      expect(config.bpm).toBeDefined();
      expect(config.ppq).toBeDefined();
      expect(config.composers).toBeDefined();
    });
  });

  describe('getConfig() and setConfig()', () => {
    it('should get current global config', () => {
      const config = getConfig();
      expect(config).toBeDefined();
      expect(config.bpm).toBeDefined();
    });

    it('should throw error when setting invalid config', () => {
      const invalidConfig: PolychronConfig = { ...DEFAULT_CONFIG, bpm: 10 };
      expect(() => setConfig(invalidConfig)).toThrow();
    });

    it('should throw error with multiple validation failures', () => {
      const invalidConfig: PolychronConfig = { ...DEFAULT_CONFIG, bpm: 10, ppq: 50 };
      expect(() => setConfig(invalidConfig)).toThrow();
    });

    it('should maintain config after reset', () => {
      const config = getConfig();
      resetConfig();
      const configAfterReset = getConfig();
      expect(configAfterReset).toBeDefined();
    });
  });

  describe('resetConfig()', () => {
    it('should reset to default', () => {
      const originalBpm = DEFAULT_CONFIG.bpm;
      const config = getConfig();
      config.bpm = 999;
      resetConfig();
      expect(getConfig().bpm).toBe(originalBpm);
    });

    it('should be idempotent', () => {
      resetConfig();
      const config1 = getConfig();
      resetConfig();
      const config2 = getConfig();
      expect(config1.bpm).toBe(config2.bpm);
    });

    it('should not affect DEFAULT_CONFIG constant', () => {
      const originalBpm = DEFAULT_CONFIG.bpm;
      const config = getConfig();
      config.bpm = 888;
      expect(DEFAULT_CONFIG.bpm).toBe(originalBpm);
    });
  });

  describe('Config structure', () => {
    it('should have composers array', () => {
      const config = getConfig();
      expect(Array.isArray(config.composers)).toBe(true);
      config.composers.forEach(c => {
        expect(c.type).toBeDefined();
      });
    });

    it('should have section types', () => {
      const config = getConfig();
      expect(Array.isArray(config.sectionTypes)).toBe(true);
      config.sectionTypes.forEach(s => {
        expect(s.type).toBeDefined();
        expect(s.weight).toBeDefined();
      });
    });

    it('should have instruments configured', () => {
      const config = getConfig();
      expect(config.primaryInstrument).toBeDefined();
      expect(config.bassInstrument).toBeDefined();
      expect(Array.isArray(config.drumSets)).toBe(true);
    });

    it('should have valid range configs', () => {
      const config = getConfig();
      const ranges = [config.numerator, config.denominator, config.octave, config.voices, config.divisions];
      ranges.forEach(range => {
        expect(range.min).toBeGreaterThanOrEqual(0);
        expect(range.max).toBeGreaterThanOrEqual(range.min);
      });
    });
  });

  describe('Binaural configuration', () => {
    it('should have valid binaural config', () => {
      const config = getConfig();
      expect(config.binaural.min).toBeGreaterThan(0);
      expect(config.binaural.max).toBeGreaterThan(config.binaural.min);
      expect(config.binaural.max).toBeLessThanOrEqual(40);
    });
  });

  describe('Logging and output', () => {
    it('should have log setting', () => {
      const config = getConfig();
      expect(typeof config.log).toBe('string');
    });

    it('should have valid silentOutroSeconds', () => {
      const config = getConfig();
      expect(config.silentOutroSeconds).toBeGreaterThanOrEqual(0);
      expect(config.silentOutroSeconds).toBeLessThanOrEqual(60);
    });
  });
});
