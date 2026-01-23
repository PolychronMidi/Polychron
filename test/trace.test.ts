import { describe, it, expect } from 'vitest';
import * as Trace from '../src/trace.js';

describe('trace module sanity', () => {
  it('should export shouldTrace and trace functions', () => {
    expect(typeof Trace.shouldTrace).toBe('function');
    expect(typeof Trace.trace).toBe('function');
    expect(typeof Trace.traceWarn).toBe('function');
  });
});
