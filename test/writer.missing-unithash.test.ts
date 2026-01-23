import { expect, test } from 'vitest';
import { CSVBuffer, pushMultiple } from '../src/writer.js';
import { getPolychronContext } from '../src/PolychronInit.js';

test('pushMultiple throws when non-marker event without unitHash and failOnMissingUnitHash is enabled', () => {
  const poly = getPolychronContext();
  // Enable strict failure for the duration of this test
  poly.test.failOnMissingUnitHash = true;

  const buf = new CSVBuffer('test');

  expect(() => pushMultiple(buf as any, { tick: 0, type: 'note_on_c', vals: [1, 2, 3] } as any)).toThrow(/FAIL_ON_MISSING_UNITHASH/);

  // Cleanup to avoid leaking this flag to other tests
  poly.test.failOnMissingUnitHash = false;
});
