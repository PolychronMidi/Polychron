import '../../src/sheet.js';
import '../../src/venue.js';
import '../../src/composers.js';
import { ModeComposer } from '../../src/composers.js';
import { setupGlobalState } from '../helpers.js';

const { RandomModeComposer } = globalThis as any;

describe('ModeComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

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
  beforeEach(() => {
    setupGlobalState();
  });

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
