import { initializePlayEngine, getCurrentCompositionContext } from '../srcplay.js';

(async () => {
  try {
    console.log('Starting deterministic inspect (seed=12345)');
    // Prefer an existing running context to avoid concurrent-run rejection
    let ctx = getCurrentCompositionContext();
    if (!ctx) {
      try {
        await initializePlayEngine(undefined, undefined, { seed: 12345 });
        ctx = getCurrentCompositionContext();
      } catch (e) {
        // If initialize failed due to concurrent run, poll briefly for an existing context
        if (String(e && e.message).includes('concurrent run detected')) {
          const start = Date.now();
          while (!ctx && (Date.now() - start) < 2000) {
            await new Promise(r => setTimeout(r, 50));
            ctx = getCurrentCompositionContext();
          }
        } else {
          throw e;
        }
      }
    }
    if (!ctx) {
      console.error('No composition context available');
      process.exit(2);
    }

    const LM = ctx.LM;
    if (!LM || !LM.layers) {
      console.error('LayerManager or layers not available on ctx');
      process.exit(2);
    }

    if (LM && LM.layers && Object.keys(LM.layers).length) {
      for (const [name, layer] of Object.entries(LM.layers)) {
        const buf = layer.buffer;
        const rows = Array.isArray(buf) ? buf : (buf && buf.rows) || [];
        const total = rows.length;
        const onCount = rows.filter(r => r && (r.type === 'on' || r.type === 'note_on' || String(r.type).toLowerCase().includes('note_on'))).length;
        const noteOnLike = rows.filter(r => r && (r.type === 'on' || (r.type && String(r.type).toLowerCase().includes('note_on'))));
        console.log(`\nLayer=${name} totalRows=${total} onLike=${onCount}`);
        console.log('Sample 10 rows:');
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const r = rows[i];
          console.log(i, JSON.stringify(r));
        }

        console.log('\nSample of up to 20 on-like events (showing tick,type,vals):');
        for (let i = 0, n = 0; i < rows.length && n < 20; i++) {
          const r = rows[i];
          if (!r) continue;
          const t = r.type;
          if (t === 'on' || (t && String(t).toLowerCase().includes('note_on'))) {
            console.log(`tick=${r.tick} type=${r.type} vals=${JSON.stringify(r.vals)}`);
            n++;
          }
        }
      }
    } else {
      // No LayerManager available; fallback to building a minimal test context and invoking PlayNotes directly
      console.log('No LM.layers found; creating manual test context and invoking Stage.playNotes to generate a small sample');
      // Minimal manual setup
      const { CompositionStateService } = await import('../srcCompositionState.js');
      const { DIContainer } = await import('../srcDIContainer.js');
      const { registerWriterServices, CSVBuffer } = await import('../srcwriter.js');
      const { createCompositionContext } = await import('../srcCompositionContext.js');
      const { stage } = await import('../srcstage.js');

      const state = new CompositionStateService();
      state.BPM = 120;
      state.PPQ = 480;
      state.composer = { getNotes: () => [ { note: 60 }, { note: 62 }, { note: 64 } ] };
      state.numerator = 4;
      state.denominator = 4;
      state.midiBPM = 120;

      const services = new DIContainer();
      registerWriterServices(services);
      // Create a CSV buffer and a minimal LM-like object
      const c = new CSVBuffer('manual');
      const ctxManual = createCompositionContext(services, { emit: () => {}, on: () => {}, off: () => {} }, { BPM: 120, PPQ: 480, SECTIONS: { min: 1, max: 1 }, COMPOSERS: [] }, undefined, undefined, c, 'none');
      ctxManual.state = state;
      ctxManual.services = services;
      ctxManual.csvBuffer = c;
      ctxManual.LM = { layers: { primary: { buffer: c, state: {} } }, activeLayer: 'primary' };

      // Run a few iterations of playNotes/playNotes2
      console.log('Invoking playNotes/playNotes2 a few times to generate events');
      for (let i = 0; i < 5; i++) {
        stage.playNotes(ctxManual);
        stage.playNotes2(ctxManual);
      }

      const rows = c.rows || c;
      console.log(`Manual ctx produced rows=${rows.length}`);
      const onLike = rows.filter(r => r && (r.type === 'on' || (r.type && String(r.type).toLowerCase().includes('note_on'))));
      console.log('Manual onLike count=', onLike.length);
      for (let i = 0; i < Math.min(20, onLike.length); i++) console.log(JSON.stringify(onLike[i]));
    }

    // Also check ctx.csvBuffer reference if present
    const globalBuf = ctx.csvBuffer;
    if (globalBuf) {
      const rows = Array.isArray(globalBuf) ? globalBuf : (globalBuf.rows || []);
      console.log(`\nctx.csvBuffer rows=${rows.length}`);
    }

    process.exit(0);
  } catch (e) {
    console.error('Inspect failed:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
