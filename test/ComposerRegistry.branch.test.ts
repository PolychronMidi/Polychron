import { describe, it, expect, beforeEach } from 'vitest';
import ComposerRegistry from '../src/ComposerRegistry';

class StubScale { constructor(name: string, root: string) { this.name = name; this.root = root; } }
class StubChord { constructor(prog: any) { this.prog = prog; } }
class StubMode { constructor(n: string, r: string) { this.n = n; this.r = r; } }

describe('ComposerRegistry - branch tests', () => {
  beforeEach(() => {
    (globalThis as any).ScaleComposer = StubScale;
    (globalThis as any).ChordComposer = StubChord;
    (globalThis as any).ModeComposer = StubMode;
    (globalThis as any).PentatonicComposer = StubScale;
    (globalThis as any).MeasureComposer = function() { this.ok = true; };
    (globalThis as any).ri = () => 0;
    (globalThis as any).allScales = ['major'];
    (globalThis as any).allNotes = ['C'];
    (globalThis as any).allChords = ['Cmaj'];
    (globalThis as any).allModes = ['ionian'];

    // Reset singleton
    (ComposerRegistry as any).instance = undefined;
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
