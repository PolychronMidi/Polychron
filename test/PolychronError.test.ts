import { describe, it, expect } from 'vitest';
import { PolychronError, ErrorCode } from '../src/PolychronError';

describe('PolychronError', () => {
  it('should create error with message', () => {
    const error = new PolychronError(ErrorCode.VALIDATION_GENERIC, 'Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('PolychronError');
  });

  it('should be instance of Error', () => {
    const error = new PolychronError(ErrorCode.VALIDATION_GENERIC, 'Test error');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof PolychronError).toBe(true);
  });

  it('should preserve stack trace', () => {
    const error = new PolychronError(ErrorCode.VALIDATION_GENERIC, 'Stack test');
    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new PolychronError(ErrorCode.VALIDATION_GENERIC, 'Throw test');
    }).toThrow(PolychronError);
  });

  it('should allow catching with specific message', () => {
    try {
      throw new PolychronError(ErrorCode.VALIDATION_GENERIC, 'Specific message');
    } catch (e) {
      expect(e).toBeInstanceOf(PolychronError);
      expect((e as PolychronError).message).toBe('Specific message');
    }
  });
});
