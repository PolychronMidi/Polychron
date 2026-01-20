import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionStateService } from '../src/CompositionState';

describe('CompositionState - branch tests', () => {
  let s: CompositionStateService;
  beforeEach(() => {
    s = new CompositionStateService();
    s.reset();
    // ensure globals are clean
    delete (globalThis as any).sectionIndex;
    delete (globalThis as any).BPM;
  });

  it('syncToGlobal writes expected properties', () => {
    s.sectionIndex = 2;
    s.BPM = 99;
    s.syncToGlobal();
    // global values should reflect service
    expect((globalThis as any).sectionIndex).toBe(2);
    expect((globalThis as any).BPM).toBe(99);
  });

  it('syncFromGlobal reads properties when set', () => {
    (globalThis as any).sectionIndex = 5;
    (globalThis as any).BPM = 111;
    s.syncFromGlobal();
    expect(s.sectionIndex).toBe(5);
    expect(s.BPM).toBe(111);
  });

  it('reset restores defaults', () => {
    s.sectionIndex = 9;
    s.BPM = 200;
    s.reset();
    expect(s.sectionIndex).toBe(0);
    expect(s.BPM).toBe(s.BASE_BPM);
  });
});
