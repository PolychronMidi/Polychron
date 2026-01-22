import { initializePolychronContext } from '../src/PolychronInit.js';
import ComposerRegistry from '../src/ComposerRegistry.js';

describe('ComposerRegistry timing API', () => {
  it('should create composers with timing API methods', () => {
    initializePolychronContext();
    const registry = ComposerRegistry.getInstance();

    const measure = registry.create({ type: 'measure' } as any);
    expect(measure).toBeDefined();
    expect(typeof measure.getMeter).toBe('function');
    expect(typeof measure.getDivisions).toBe('function');
    expect(typeof measure.getSubdivisions).toBe('function');
  });
});
