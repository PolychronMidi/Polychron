import '../../src/sheet.js';
import '../../src/venue.js';
import '../../src/composers.js';
import { setupGlobalState } from '../helpers.js';

import { ProgressionGenerator } from '../../src/composers/ProgressionGenerator';

describe('ProgressionGenerator', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should create with key and quality', () => {
    const gen = new ProgressionGenerator('C', 'major', { t: globalThis.t, ri: (n: number) => 0 });
    expect(gen.key).toBe('C');
    expect(gen.quality).toBe('major');
  });

  it('should generate I-IV-V progression in major', () => {
    const gen = new ProgressionGenerator('C', 'major', { t: globalThis.t, ri: (n: number) => 0 });
    const prog = gen.generate('I-IV-V');
    expect(prog).toBeDefined();
    expect(prog.length).toBeGreaterThan(0);
    expect(prog[0]).toContain('C');
  });

  it('should generate ii-V-I jazz turnaround', () => {
    const gen = new ProgressionGenerator('C', 'major', { t: globalThis.t, ri: (n: number) => 0 });
    const prog = gen.generate('ii-V-I');
    expect(prog).toBeDefined();
    expect(prog.length).toBe(3);
  });

  it('should generate pop progression I-V-vi-IV', () => {
    const gen = new ProgressionGenerator('C', 'major');
    const prog = gen.generate('I-V-vi-IV');
    expect(prog).toBeDefined();
    expect(prog.length).toBe(4);
  });

  it('should generate minor progressions', () => {
    const gen = new ProgressionGenerator('A', 'minor');
    const prog = gen.generate('i-iv-v');
    expect(prog).toBeDefined();
    expect(prog.length).toBeGreaterThan(0);
  });

  it('should generate andalusian cadence', () => {
    const gen = new ProgressionGenerator('A', 'minor');
    const prog = gen.generate('andalusian');
    expect(prog).toBeDefined();
    expect(prog.length).toBe(4);
  });

  it('should generate circle of fifths', () => {
    const gen = new ProgressionGenerator('C', 'major', { t: globalThis.t, ri: (n: number) => 0 });
    const prog = gen.generate('circle');
    expect(prog).toBeDefined();
    expect(prog.length).toBeGreaterThan(4);
  });

  it('should generate 12-bar blues', () => {
    const gen = new ProgressionGenerator('E', 'major', { t: globalThis.t, ri: (n: number) => 0 });
    const prog = gen.generate('blues');
    expect(prog).toBeDefined();
    expect(prog.length).toBe(12);
  });

  it('should generate random progression', () => {
    const gen = new ProgressionGenerator('G', 'major');
    const prog = gen.random();
    expect(prog).toBeDefined();
    expect(prog.length).toBeGreaterThan(0);
  });

  it('should convert Roman numerals to chords', () => {
    const gen = new ProgressionGenerator('C', 'major');
    const chord = gen.romanToChord('I');
    expect(chord).toBeTruthy();
    expect(chord).toContain('C');
  });

  it('should handle invalid progression types gracefully', () => {
    const gen = new ProgressionGenerator('C', 'major');
    const prog = gen.generate('invalid-type');
    expect(prog).toBeDefined();
    expect(prog.length).toBeGreaterThan(0);
  });
});
