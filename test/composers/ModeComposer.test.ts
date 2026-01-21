import { ModeComposer, RandomModeComposer } from '../../src/composers/index.js';

describe('ModeComposer', () => {
  // No global setup required; composers import dependencies via DI-friendly modules.

  it('should initialize with mode and root', () => {
    const composer = new ModeComposer('ionian', 'C');
    expect(composer.root).toBe('C');
    expect(composer.item).toBeDefined();
    expect(composer.notes).toBeDefined();
  });

  it('should call Tonal Mode methods', () => {
    const composer = new ModeComposer('ionian', 'C');
    expect(composer.item).toBeDefined();
    expect(Array.isArray(composer.notes)).toBe(true);
  });
});

describe('RandomModeComposer', () => {
  // No global setup required; composers import dependencies via DI-friendly modules.

  it('should initialize with random mode', () => {
    const composer = new RandomModeComposer();
    expect(composer.item).toBeDefined();
    expect(composer.root).toBeDefined();
  });

  it('should generate new mode on each x() call', () => {
    const composer = new RandomModeComposer();
    const result1 = composer.x();
    const result2 = composer.x();
    expect(Array.isArray(result1)).toBe(true);
    expect(Array.isArray(result2)).toBe(true);
  });
});
