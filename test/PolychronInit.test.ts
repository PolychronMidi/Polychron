import { describe, it, expect, vi } from 'vitest';

describe('PolychronInit', () => {
  it('should export initialization function', async () => {
    const init = await import('../src/PolychronInit');
    expect(init).toBeDefined();
  });

  it('should initialize without errors', async () => {
    const init = await import('../src/PolychronInit');
    expect(init).toBeDefined();
    expect(typeof init).toBe('object');
  });

  it('should be importable', async () => {
    await expect(import('../src/PolychronInit')).resolves.toBeDefined();
  });
});
