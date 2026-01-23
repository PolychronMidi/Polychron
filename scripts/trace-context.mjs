process.env.NODE_ENV = 'test';
// Prevent module auto-start during instrumentation runs
globalThis.__POLYCHRON_PREVENT_AUTO_START = true;

(async () => {
  const mod = await import('../dist/play.js');
  const { initializePlayEngine } = mod;
  const { getPolychronContext } = await import('../dist/PolychronInit.js');
  const poly = getPolychronContext();
  poly.test = poly.test || {};
  // Keep run short and deterministic
  poly.test.SECTIONS = { min: 1, max: 1 };
  poly.test.SILENT_OUTRO_SECONDS = 0;
  poly.test.COMPOSERS = [{ getMeter: () => [4, 4], getNotes: () => [{ note: 60 }], getDivisions: () => 1, getSubdivisions: () => 1 }];
  // Use full-file trace: collect snapshots into memory (no per-unit console spam), then write a single JSON file at run end.
  poly.test._traceMode = 'full-file';
  poly.test.fastTrace = true;
  poly.test.strictTotalSections = true; // fail-fast on invalid writes
  poly.test.enableLogging = false; // disable noisy logs from other modules
  poly.test._traceSnapshotLimit = 10000; // cap to keep memory reasonable
  poly.test._traceFilePath = 'output/trace-full.json';
  // Fail-fast: enable full tracing and strict mode so invalid writes throw immediately
  poly.test._traceMode = 'full';
  poly.test.strictTotalSections = true;

  try {
    console.log('[trace-context] Starting initializePlayEngine (short run)');
    const ctx = await initializePlayEngine(undefined, undefined, { seed: 424242 });
    console.log('[trace-context] initializePlayEngine complete; context snapshot:', {
      sectionIndex: ctx.state.sectionIndex,
      phraseIndex: ctx.state.phraseIndex,
      measureIndex: ctx.state.measureIndex,
      measureStart: ctx.state.measureStart,
      tpMeasure: ctx.state.tpMeasure
    });
    process.exit(0);
  } catch (err) {
    console.error('[trace-context] initializePlayEngine failed:', err);
    process.exit(2);
  }
})();
