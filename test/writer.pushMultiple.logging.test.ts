import { pushMultiple, CSVBuffer } from '../src/writer.js';

describe('pushMultiple logging gating', () => {
  beforeEach(() => { (globalThis as any).__POLYCHRON_TEST__ = {}; delete (globalThis as any).__POLYCHRON_TEST__.enableLogging; });
  afterEach(() => { (globalThis as any).__POLYCHRON_TEST__ = {}; vi.restoreAllMocks(); });

  it('does not log provenance by default', () => {
    const buf = new CSVBuffer('test');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    pushMultiple(buf, { tick: 0, type: 'NoteOn', vals: [1] } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs provenance when test logging enabled', () => {
    (globalThis as any).__POLYCHRON_TEST__ = { enableLogging: true };
    const buf = new CSVBuffer('test');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    pushMultiple(buf, { tick: 0, type: 'NoteOn', vals: [1] } as any);
    expect(spy).toHaveBeenCalled();
  });
});
