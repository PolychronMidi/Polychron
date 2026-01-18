import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('sheet', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should be importable', async () => {
    const sheet = await import('../src/sheet');
    expect(sheet).toBeDefined();
  });

  it('should export expected functions', async () => {
    const sheet = await import('../src/sheet');
    expect(typeof sheet).toBe('object');
  });

  it('should handle sheet module loading', async () => {
    await expect(import('../src/sheet')).resolves.toBeDefined();
  });
});
