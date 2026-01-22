import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionStateService } from '../src/CompositionState';
import { getPolychronContext } from '../src/PolychronInit';

describe('CompositionState - branch tests', () => {
  let s: CompositionStateService;
  const poly = getPolychronContext();

  beforeEach(() => {
    s = new CompositionStateService();
    s.reset();
    // ensure DI namespaces are clean
    if (poly.state) {
      delete poly.state.sectionIndex;
      delete poly.state.BPM;
    }
    if (poly.test) {
      delete poly.test.sectionIndex;
      delete poly.test.BPM;
    }
  });

  it('syncToGlobal writes expected properties', () => {
    s.sectionIndex = 2;
    s.BPM = 99;
    s.syncToGlobal();

    // DI-friendly state should reflect service
    expect(poly.state.sectionIndex).toBe(2);
    expect(poly.state.BPM).toBe(99);
  });

  it('syncFromGlobal reads properties when set', () => {
    poly.state = poly.state || {} as any;
    poly.state.sectionIndex = 5;
    poly.state.BPM = 111;
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
