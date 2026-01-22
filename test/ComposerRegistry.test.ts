// ComposerRegistry.test.js - Unit tests for the ComposerRegistry singleton
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ComposerRegistry', () => {
  beforeEach(() => {
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

    it('should throw when no type is specified (DI-only)', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      expect(() => registry.create({})).toThrow('No factory registered');
    });
  });

  describe('Error Handling', () => {
    it('should throw for unknown types (DI-only)', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      expect(() => registry.create({ type: 'nonexistent' })).toThrow('No factory registered');
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

      // Re-register scale factory after clear in beforeEach (DI-friendly)
      const { allScales, allNotes } = await import('../src/venue.js');
      const { ri } = await import('../src/utils.js');
      registry.register('scale', ({ name = 'major', root = 'C' } = {}) => {
        const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
        const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
        return { type: 'scale', scale: n, root: r };
      });

      const composer = registry.create({ type: 'scale', name: 'random', root: 'random' });

      expect(composer.type).toBe('scale');
      expect(allScales).toContain(composer.scale);
      expect(allNotes).toContain(composer.root);
    });

    it('should handle random chord progression via factory', async () => {
      const { ComposerRegistry } = await import('../src/ComposerRegistry.js');
      const registry = ComposerRegistry.getInstance();

      // Re-register chords factory after clear in beforeEach (DI-friendly)
      const { allChords } = await import('../src/venue.js');
      const { ri } = await import('../src/utils.js');
      registry.register('chords', ({ progression = ['C'] } = {}) => {
        let p = Array.isArray(progression) ? progression : ['C'];
        if (typeof progression === 'string' && progression === 'random') {
          const len = ri(2, 5);
          p = [];
          for (let i = 0; i < len; i++) {
            p.push(allChords[ri(allChords.length - 1)]);
          }
        }
        return { type: 'chord', progression: p };
      });

      const composer = registry.create({ type: 'chords', progression: 'random' });

      expect(composer.type).toBe('chord');
      expect(Array.isArray(composer.progression)).toBe(true);
      expect(composer.progression.length).toBeGreaterThan(0);
    });
  });

  describe('Module exports', () => {
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
