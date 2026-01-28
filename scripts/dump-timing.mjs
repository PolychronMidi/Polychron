// Dump timing by running a child Node process which imports play.js (keeps this script free of in-process imports)
const { spawnSync } = require('child_process');
const childScript = `
(async () => {
  try {
    const mod = './' + ['src','play.js'].join('/');
    const { initializePlayEngine, getCurrentCompositionContext } = await import(mod);
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const ctx = getCurrentCompositionContext();
    const tree = (ctx && ctx.state && ctx.state.timingTree) || {};
    console.log(JSON.stringify({ primary: tree['primary'] || null }));
  } catch (e) { console.error('CHILD_ERR', e && e.stack ? e.stack : e); process.exit(2); }
})();
`;
const res = spawnSync(process.execPath, ['-e', childScript], { env: process.env, stdio: ['ignore','pipe','inherit'], encoding: 'utf8' });
if (res.error) { console.error('Child execution failed', res.error); process.exit(1); }
if (res.status !== 0) process.exit(res.status);
try {
  const parsed = JSON.parse(res.stdout.trim());
  const layer = parsed.primary;
  if (!layer || !layer.children || !layer.children.section) {
    console.log('No timing tree available for primary layer');
    process.exit(0);
  }
  const secs = Object.keys(layer.children.section).map(k => Number(k)).sort((a, b) => a - b);
  console.log('Primary layer timing snapshot (sections -> phrases -> measures):');
  for (const s of secs) {
    const sec = layer.children.section[String(s)];
    console.log(`section ${s}:`, sec && sec.children && Object.keys(sec.children.phrase || {}).length, 'phrases');
    if (!sec || !sec.children || !sec.children.phrase) continue;
    const phs = Object.keys(sec.children.phrase).map(k => Number(k)).sort((a,b)=>a-b);
    for (const p of phs) {
      const phr = sec.children.phrase[String(p)];
      console.log(`  phrase ${p}:`, phr && phr.children && Object.keys(phr.children.measure || {}).length, 'measures');
      if (!phr || !phr.children || !phr.children.measure) continue;
      const meas = Object.keys(phr.children.measure).map(k => Number(k)).sort((a,b)=>a-b);
      for (const m of meas) {
        const mn = phr.children.measure[String(m)];
        console.log(`    measure ${m}: start=${mn.start} end=${mn.end} tpMeasure=${mn.tpMeasure}`);
      }
    }
  }
} catch (e) {
  console.error('Failed to parse child output', e && e.stack ? e.stack : e, 'stdout:', res.stdout);
  process.exit(2);
}
