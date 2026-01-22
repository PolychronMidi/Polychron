import { initializePolychronContext } from '../src/PolychronInit.js';
import ComposerRegistry from '../src/ComposerRegistry.js';

describe('ComposerRegistry integration timing APIs', () => {
  it('creates timing-focused composers with timing API methods', () => {
    initializePolychronContext();
    const registry = ComposerRegistry.getInstance();
    const timingTypes = ['measure', 'harmonicRhythm', 'tensionRelease', 'modalInterchange', 'melodicDevelopment', 'advancedVoiceLeading'];
    timingTypes.forEach((t: string) => {
      if (!registry.has(t)) return; // optional: some DI configurations may not register advanced composers
      const c = registry.create({ type: t as any });
      expect(c).toBeDefined();
      expect(typeof c.getMeter).toBe('function');
      expect(typeof c.getDivisions).toBe('function');
      expect(typeof c.getSubdivisions).toBe('function');
      expect(typeof c.getVoices).toBe('function');
    });
  });
});
