import { initializePlayEngine } from '../src/play.js';
import { getPolychronContext } from '../src/PolychronInit.js';

// Debug test: enable detailed logging and run a short deterministic composition to capture tick=0 logs
it('debug tick0 logging (instrumentation)', async () => {
  const poly = getPolychronContext();
  poly.test = poly.test || {} as any;
  poly.test.enableLogging = true; // turn on detailed provenance logging
  // Keep composition short/deterministic to avoid timeouts
  poly.test.SECTIONS = { min: 1, max: 1 };
  poly.test.SILENT_OUTRO_SECONDS = 0;
  poly.test.COMPOSERS = [ { getMeter: () => [4,4], getNotes: () => [] } ];
  // Use deterministic seed for reproducibility
  await initializePlayEngine(undefined, undefined, { seed: 12345 });
}, 120000);
