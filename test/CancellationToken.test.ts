import { describe, it, expect } from 'vitest';
import { CancellationTokenSource } from '../src/CancellationToken';

describe('CancellationToken', () => {
  it('should initialize with isCancelled false', () => {
    const source = new CancellationTokenSource();
    const token = source.token;
    expect(token.isCancelled).toBe(false);
  });

  it('should set isCancelled to true when cancel is called', () => {
    const source = new CancellationTokenSource();
    const token = source.token;
    source.cancel();
    expect(token.isCancelled).toBe(true);
  });

  it('should remain cancelled after multiple cancel calls', () => {
    const source = new CancellationTokenSource();
    const token = source.token;
    source.cancel();
    source.cancel();
    expect(token.isCancelled).toBe(true);
  });

  it('should support checking cancellation status multiple times', () => {
    const source = new CancellationTokenSource();
    const token = source.token;
    expect(token.isCancelled).toBe(false);
    expect(token.isCancelled).toBe(false);
    source.cancel();
    expect(token.isCancelled).toBe(true);
    expect(token.isCancelled).toBe(true);
  });
});
