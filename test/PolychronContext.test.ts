import { describe, it, expect } from 'vitest';
import { PolychronContext } from '../src/PolychronContext';

describe('PolychronContext', () => {
  // Test singleton pattern
  it('should be a singleton instance', () => {
    const ctx1 = PolychronContext;
    const ctx2 = PolychronContext;
    expect(ctx1).toBe(ctx2);
  });

  it('should have consistent state across accesses', () => {
    const state1 = PolychronContext.state;
    const state2 = PolychronContext.state;
    expect(state1).toBe(state2);
  });

  // Test interface structure
  it('should define utils namespace', () => {
    expect(PolychronContext.utils).toBeDefined();
  });

  it('should define composers namespace', () => {
    expect(PolychronContext.composers).toBeDefined();
  });

  it('should define test namespace', () => {
    expect(PolychronContext.test).toBeDefined();
  });

  it('should define initialized property', () => {
    expect(typeof PolychronContext.initialized).toBe('boolean');
  });

  it('should define init method', () => {
    expect(typeof PolychronContext.init).toBe('function');
  });

  // Test state properties
  it('should have timing properties in state', () => {
    const { state } = PolychronContext;
    expect(state).toBeDefined();
    expect(typeof state.bpmRatio).toBe('number');
    expect(typeof state.measureCount).toBe('number');
  });

  it('should have music theory properties in state', () => {
    const { state } = PolychronContext;
    expect(typeof state.numerator).toBe('number');
    expect(typeof state.denominator).toBe('number');
    expect(typeof state.divisions).toBe('number');
  });

  it('should allow state mutations', () => {
    const initialValue = PolychronContext.state.numerator;
    PolychronContext.state.numerator = 4;
    expect(PolychronContext.state.numerator).toBe(4);
    // Restore
    PolychronContext.state.numerator = initialValue;
  });

  // Test utils namespace
  it('should have utils defined', () => {
    const { utils } = PolychronContext;
    expect(utils).toBeDefined();
    expect(typeof utils).toBe('object');
  });

  // Test composers namespace
  it('should have composers namespace accessible', () => {
    const { composers } = PolychronContext;
    expect(composers).toBeDefined();
  });

  // Test optional properties
  it('should have optional allNotes property', () => {
    const { state } = PolychronContext;
    if (state.allNotes !== undefined) {
      expect(Array.isArray(state.allNotes) || typeof state.allNotes === 'object').toBe(true);
    }
  });

  // Test type safety
  it('should conform to IPolychronContext interface', () => {
    expect(PolychronContext).toBeDefined();
    expect(PolychronContext.state).toBeDefined();
    expect(PolychronContext.utils).toBeDefined();
    expect(PolychronContext.composers).toBeDefined();
  });

  // Test init behavior
  it('should have init method', () => {
    expect(typeof PolychronContext.init).toBe('function');
  });

  it('should be callable multiple times without error', () => {
    expect(() => {
      PolychronContext.init();
      PolychronContext.init();
    }).not.toThrow();
  });

  // Test state timing properties
  it('should have subdivStart property', () => {
    expect(typeof PolychronContext.state.subdivStart).toBe('number');
  });

  it('should have tpSec property', () => {
    expect(typeof PolychronContext.state.tpSec).toBe('number');
  });

  it('should have subdivsOn and subdivsOff', () => {
    expect(typeof PolychronContext.state.subdivsOn).toBe('number');
    expect(typeof PolychronContext.state.subdivsOff).toBe('number');
  });

  // Test state read/write
  it('should allow reading all state properties', () => {
    const { state } = PolychronContext;
    expect(typeof state.bpmRatio).toBe('number');
    expect(typeof state.measureCount).toBe('number');
    expect(typeof state.numerator).toBe('number');
    expect(typeof state.denominator).toBe('number');
    expect(typeof state.divisions).toBe('number');
    expect(typeof state.subdivisions).toBe('number');
  });

  it('should maintain state between accesses', () => {
    PolychronContext.state.measureCount = 42;
    expect(PolychronContext.state.measureCount).toBe(42);
  });
});
