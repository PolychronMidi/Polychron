import { describe, it, expect, beforeEach } from 'vitest';
import ComposerRegistry from '../src/ComposerRegistry';

class StubScale { constructor(name: string, root: string) { this.name = name; this.root = root; } }
class StubChord { constructor(prog: any) { this.prog = prog; } }
class StubMode { constructor(n: string, r: string) { this.n = n; this.r = r; } }

describe('ComposerRegistry - branch tests', () => {
  beforeEach(() => {
    // Reset singleton and inject test factories directly into the registry (no globals)
    (ComposerRegistry as any).instance = undefined;
    const registry = ComposerRegistry.getInstance();
    registry.clear();
    registry.register('measure', () => ({ ok: true }));
    registry.register('scale', ({ name = 'major', root = 'C' } = {}) => new StubScale(name, root));
    registry.register('chords', ({ progression = ['C'] } = {}) => new StubChord(progression));
    registry.register('mode', ({ name = 'ionian', root = 'C' } = {}) => new StubMode(name, root));
    registry.register('pentatonic', ({ root = 'C' } = {}) => new StubScale('pent', root));
  });

  it('registerDefaults allows creating composers by type', () => {
    const registry = ComposerRegistry.getInstance();
    const scale = registry.create({ type: 'scale', name: 'major', root: 'C' });
    expect(scale).toBeInstanceOf(StubScale);
    const chord = registry.create({ type: 'chords', progression: ['C'] });
    expect(chord).toBeInstanceOf(StubChord);
    const mode = registry.create({ type: 'mode', name: 'ionian', root: 'C' });
    expect(mode).toBeInstanceOf(StubMode);
  });

  it('create falls back to scale for unknown types', () => {
    const registry = ComposerRegistry.getInstance();
    const c = registry.create({ type: 'unknown' });
    expect(c).toBeInstanceOf(StubScale);
  });

  it('clear removes registrations', () => {
    const registry = ComposerRegistry.getInstance();
    registry.clear();
    expect(registry.getTypes().length).toBe(0);
    expect(() => registry.create({ type: 'scale' })).toThrow();
  });
});
