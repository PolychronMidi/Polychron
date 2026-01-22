import ComposerRegistry from '../src/ComposerRegistry.js';
import { initializePolychronContext } from '../src/PolychronInit.js';

describe('ComposerRegistry strict DI contract', () => {
  it('should throw when a registered factory returns an incomplete composer', () => {
    initializePolychronContext();
    const registry = ComposerRegistry.getInstance();

    // Overwrite 'measure' with a deliberately invalid factory and expect strict validation to catch it
    registry.register('measure', () => ({ foo: 'bar' } as any));

    expect(() => registry.create({ type: 'measure' } as any)).toThrow(/missing required API methods/);
  });
});
