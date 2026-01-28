// Run an in-process inspection in a child process to avoid importing play.js here
const { spawnSync } = require('child_process');
const childScript = `
(async () => {
  try {
    const mod = './' + ['src','play.js'].join('/');
    const { initializePlayEngine, getCurrentCompositionContext } = await import(mod);
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const ctx = getCurrentCompositionContext();
    const layers = Object.keys(ctx && ctx.LM && ctx.LM.layers ? ctx.LM.layers : {});
    const out = { layers, layerSamples: {} };
    for (const name of layers) {
      const buf = ctx.LM.layers[name].buffer;
      const rows = Array.isArray(buf) ? buf : (buf && buf.rows) || [];
      out.layerSamples[name] = { total: rows.length, sample: rows.slice(0, 10) };
    }
    console.log(JSON.stringify(out));
  } catch (e) { console.error('CHILD_ERR', e && e.stack ? e.stack : e); process.exit(2); }
})();
`;
const res = spawnSync(process.execPath, ['-e', childScript], { env: process.env, stdio: ['ignore','pipe','inherit'], encoding: 'utf8' });
if (res.error) { console.error('Child execution failed', res.error); process.exit(1); }
if (res.status !== 0) process.exit(res.status);
try {
  const parsed = JSON.parse(res.stdout.trim());
  console.log('Inspect summary:', parsed);
  if (parsed && parsed.layers) {
    for (const name of parsed.layers) {
      const s = parsed.layerSamples && parsed.layerSamples[name] ? parsed.layerSamples[name] : null;
      console.log(`Layer=${name} total=${s && s.total || 0}`);
    }
  }
  process.exit(0);
} catch (e) {
  console.error('Failed to parse child output', e && e.stack ? e.stack : e, 'stdout:', res.stdout);
  process.exit(2);
}
