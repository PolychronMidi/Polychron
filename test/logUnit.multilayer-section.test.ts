import { expect, test } from 'vitest';
import { CSVBuffer } from '../src/writer.js';
import { logUnit } from '../src/writer.js';

test('logUnit broadcasts section markers to all layer buffers when LM.layers present', async () => {
  const primary = new CSVBuffer('primary');
  const poly = new CSVBuffer('poly');

  const ctx: any = {
    state: { sectionIndex: 0, tpSection: 100, sectionStart: 0, tpSec: 1 },
    csvBuffer: primary,
    LM: { layers: { primary: { buffer: primary }, poly: { buffer: poly } } }
  };

  // Register writer services into a DI container so `requirePush` will succeed
  const { registerWriterServices } = await import('../src/writer.js');
  const { DIContainer } = await import('../src/DIContainer.js');
  const container = new DIContainer();
  registerWriterServices(container);
  ctx.container = container;

  logUnit('section', ctx);

  expect(primary.rows.length).toBeGreaterThan(0);
  expect(poly.rows.length).toBeGreaterThan(0);
  const p = primary.rows.find((r: any) => r.type === 'marker_t');
  const q = poly.rows.find((r: any) => r.type === 'marker_t');
  expect(p).toBeDefined();
  expect(q).toBeDefined();
});
