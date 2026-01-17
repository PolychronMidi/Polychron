// ComposerRegistry.test.js - Unit tests for the ComposerRegistry singleton
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Setup global namespace for testing
const setupGlobalState = () => {
  // Mock composer classes
  class MockScaleComposer {
    constructor(scale, root) {
      this.scale = scale;
      this.root = root;
      this.type = 'scale';
    }
  }

  class MockChordComposer {
    constructor(progression) {
      this.progression = progression;
      this.type = 'chord';
    }
  }

  class MockModeComposer {
    constructor(mode, root) {
      this.mode = mode;
      this.root = root;
      this.type = 'mode';
    }
  }

  class MockPentatonicComposer {
    constructor(root, scaleType) {
      this.root = root;
      this.scaleType = scaleType;
      this.type = 'pentatonic';
    }
  }

  class MockMeasureComposer {
    constructor() {
      this.type = 'measure';
    }
  }

  // Mock utility functions
  const ri = (min, max) => {
    if (max === undefined) return Math.floor(Math.random() * (min + 1));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // Mock data arrays
  const allScales = ['major', 'minor', 'dorian', 'phrygian'];
  const allNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const allChords = ['Cmaj', 'Dmin', 'Emin', 'Fmaj', 'Gmaj', 'Amin'];
  const allModes = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian'];

  // Assign to global
  globalThis.ScaleComposer = MockScaleComposer;
  globalThis.ChordComposer = MockChordComposer;
  globalThis.ModeComposer = MockModeComposer;
  globalThis.PentatonicComposer = MockPentatonicComposer;
  globalThis.MeasureComposer = MockMeasureComposer;
  globalThis.ri = ri;
  globalThis.allScales = allScales;
  globalThis.allNotes = allNotes;
  globalThis.allChords = allChords;
  globalThis.allModes = allModes;
};

describe('ComposerRegistry', () => {
  beforeEach(() => {
    setupGlobalState();
    // Clear singleton instance before each test
    if (globalThis.ComposerRegistry) {
      const instance = globalThis.ComposerRegistry.getInstance();
      instance.clear();
      // Reset singleton (access private field via any cast for testing)
      globalThis.ComposerRegistry.instance = undefined;
    }
  });

  afterEach(() => {
    // Clean up global state but preserve ComposerRegistry for next test
    // Note: We don't delete ComposerRegistry since it's a class, not an instance
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls to getInstance()', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const instance1 = ComposerRegistry.getInstance();
      const instance2 = ComposerRegistry.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should automatically register defaults on first getInstance()', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      // Check that core composer types are registered
      expect(registry.has('scale')).toBe(true);
      expect(registry.has('chords')).toBe(true);
      expect(registry.has('mode')).toBe(true);
      expect(registry.has('pentatonic')).toBe(true);
      expect(registry.has('measure')).toBe(true);
    });
  });

  describe('Registration', () => {
    it('should register a new composer type', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const mockFactory = (config) => ({ type: 'custom', config });
      registry.register('custom', mockFactory);

      expect(registry.has('custom')).toBe(true);
    });

    it('should overwrite existing composer type on re-registration', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const factory1 = () => ({ version: 1 });
      const factory2 = () => ({ version: 2 });

      registry.register('test', factory1);
      registry.register('test', factory2);

      const instance = registry.create({ type: 'test' });
      expect(instance.version).toBe(2);
    });

    it('should return all registered types via getTypes()', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const types = registry.getTypes();
      expect(types).toContain('scale');
      expect(types).toContain('chords');
      expect(types).toContain('mode');
      expect(types).toContain('pentatonic');
      expect(types).toContain('measure');
    });
  });

  describe('Composer Creation', () => {
    it('should create a scale composer with default config', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const composer = registry.create({ type: 'scale' });

      expect(composer).toBeDefined();
      expect(composer.type).toBe('scale');
      expect(composer.scale).toBe('major');
      expect(composer.root).toBe('C');
    });

    it('should create a scale composer with custom config', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const composer = registry.create({ type: 'scale', name: 'minor', root: 'D' });

      expect(composer.scale).toBe('minor');
      expect(composer.root).toBe('D');
    });

    it('should create a chord composer with progression', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const composer = registry.create({ type: 'chords', progression: ['Cmaj', 'Fmaj', 'Gmaj'] });

      expect(composer.type).toBe('chord');
      expect(composer.progression).toEqual(['Cmaj', 'Fmaj', 'Gmaj']);
    });

    it('should create a mode composer', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const composer = registry.create({ type: 'mode', name: 'dorian', root: 'E' });

      expect(composer.type).toBe('mode');
      expect(composer.mode).toBe('dorian');
      expect(composer.root).toBe('E');
    });

    it('should create a pentatonic composer', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const composer = registry.create({ type: 'pentatonic', root: 'A', scaleType: 'minor' });

      expect(composer.type).toBe('pentatonic');
      expect(composer.root).toBe('A');
      expect(composer.scaleType).toBe('minor');
    });

    it('should create a measure composer', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const composer = registry.create({ type: 'measure' });

      expect(composer.type).toBe('measure');
    });

    it('should default to scale type if no type specified', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const composer = registry.create({});

      expect(composer.type).toBe('scale');
    });
  });

  describe('Error Handling', () => {
    it('should warn and fallback to random scale for unknown type', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const composer = registry.create({ type: 'nonexistent' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown composer type: nonexistent'));
      expect(composer).toBeDefined();
      expect(composer.type).toBe('scale');

      consoleWarnSpy.mockRestore();
    });

    it('should throw error if no fallback available for unknown type', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      // Clear all registered composers
      registry.clear();

      expect(() => {
        registry.create({ type: 'unknown' });
      }).toThrow('No factory registered for type');
    });
  });

  describe('Clear Functionality', () => {
    it('should remove all registered composers on clear()', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      // Register a custom composer type
      registry.register('custom', () => ({ type: 'custom' }));
      const initialCount = registry.getTypes().length;
      expect(initialCount).toBeGreaterThan(0);

      registry.clear();

      expect(registry.getTypes().length).toBe(0);
      expect(registry.has('scale')).toBe(false);
      expect(registry.has('custom')).toBe(false);
    });
  });

  describe('Random Support', () => {
    it('should handle random scale parameters via factory', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      // Re-register scale factory after clear in beforeEach
      registry.register('scale', ({ name = 'major', root = 'C' } = {}) => {
        const n = name === 'random' ? globalThis.allScales[globalThis.ri(globalThis.allScales.length - 1)] : name;
        const r = root === 'random' ? globalThis.allNotes[globalThis.ri(globalThis.allNotes.length - 1)] : root;
        return new globalThis.ScaleComposer(n, r);
      });

      const composer = registry.create({ type: 'scale', name: 'random', root: 'random' });

      expect(composer.type).toBe('scale');
      expect(globalThis.allScales).toContain(composer.scale);
      expect(globalThis.allNotes).toContain(composer.root);
    });

    it('should handle random chord progression via factory', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      // Re-register chords factory after clear in beforeEach
      registry.register('chords', ({ progression = ['C'] } = {}) => {
        let p = Array.isArray(progression) ? progression : ['C'];
        if (typeof progression === 'string' && progression === 'random') {
          const len = globalThis.ri(2, 5);
          p = [];
          for (let i = 0; i < len; i++) {
            p.push(globalThis.allChords[globalThis.ri(globalThis.allChords.length - 1)]);
          }
        }
        return new globalThis.ChordComposer(p);
      });

      const composer = registry.create({ type: 'chords', progression: 'random' });

      expect(composer.type).toBe('chord');
      expect(Array.isArray(composer.progression)).toBe(true);
      expect(composer.progression.length).toBeGreaterThan(0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should make ComposerRegistry available in module exports', async () => {
      const module = await import('../src/ComposerRegistry.js');

      expect(module.ComposerRegistry).toBeDefined();
      expect(typeof module.ComposerRegistry.getInstance).toBe('function');
    });

    it('should allow getInstance() to be called from module export', async () => {
      // ComposerRegistry is imported as an ES6 module export
      const module = await import('../src/ComposerRegistry.js');

      // ComposerRegistry class should have getInstance method
      expect(typeof module.ComposerRegistry.getInstance).toBe('function');
      
      // Should be able to get instance
      const instance = module.ComposerRegistry.getInstance();
      expect(instance).toBeDefined();
    });
  });
});
