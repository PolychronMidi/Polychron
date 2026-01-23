import { expect, test } from 'vitest';
import { CSVBuffer, pushMultiple } from '../src/writer.js';
import { getPolychronContext } from '../src/PolychronInit.js';

test('pushMultiple uses TimingTree.findUnitAtTick as fallback when no unitHash present', async () => {
  const buf = new CSVBuffer('primary');
  // Ensure no current hashes
  (buf as any).currentUnitHashes = {};
  (buf as any).unitTiming = null;
  (buf as any).lastAssignedUnitHash = null;

  const poly = getPolychronContext();
  poly.state.timingTree = {}; // create timingTree
  // Build minimal timing tree with a subdivision that covers tick 42
  poly.state.timingTree['primary'] = {} as any;
  poly.state.timingTree['primary'].children = { section: { '0': { start: 0, end: 100 } } } as any;
  poly.state.timingTree['primary'].children.section['0'].children = { phrase: { '0': { start: 0, end: 100 } } } as any;
  poly.state.timingTree['primary'].children.section['0'].children.phrase['0'].children = { measure: { '0': { start: 0, end: 100 } } } as any;
  poly.state.timingTree['primary'].children.section['0'].children.phrase['0'].children.measure['0'].children = { beat: { '0': { start: 0, end: 100 } } } as any;
  poly.state.timingTree['primary'].children.section['0'].children.phrase['0'].children.measure['0'].children.beat['0'].children = { division: { '0': { start: 0, end: 100 } } } as any;
  poly.state.timingTree['primary'].children.section['0'].children.phrase['0'].children.measure['0'].children.beat['0'].children.division['0'].children = { subdivision: { '0': { start: 0, end: 100, unitHash: 'treehash1' } } } as any;

  pushMultiple(buf as any, { tick: 42, type: 'note_on_c', vals: [9, 100, 64] } as any);

  expect(buf.rows.length).toBe(1);
  const row = buf.rows[0];
  expect(String(row.tick)).toContain('|treehash1');
});
