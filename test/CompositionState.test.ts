import { describe, it, expect } from 'vitest';
import type { CompositionState } from '../src/CompositionState';

describe('CompositionState', () => {
  it('should define valid state structure', () => {
    const state: Partial<CompositionState> = {
      currentTick: 0,
      events: [],
    };

    expect(state.currentTick).toBe(0);
    expect(Array.isArray(state.events)).toBe(true);
  });

  it('should allow state with events', () => {
    const state: Partial<CompositionState> = {
      currentTick: 100,
      events: [
        { type: 'noteOn', tick: 0 },
        { type: 'noteOff', tick: 50 },
      ],
    };

    expect(state.events?.length).toBe(2);
    expect(state.currentTick).toBe(100);
  });

  it('should support empty events array', () => {
    const state: Partial<CompositionState> = {
      currentTick: 0,
      events: [],
    };

    expect(state.events).toEqual([]);
  });

  it('should allow partial state', () => {
    const state: Partial<CompositionState> = {
      currentTick: 500,
    };

    expect(state.currentTick).toBe(500);
    expect(state.events).toBeUndefined();
  });
});
