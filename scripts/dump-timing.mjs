import { initializePlayEngine } from '../srcplay.js';

(async () => {
  const ctx = await initializePlayEngine(undefined, undefined, { seed: 12345 });
  const tree = (ctx && ctx.state && ctx.state.timingTree) || {};
  console.log('Primary layer timing snapshot (sections -> phrases -> measures):');
  const layer = tree['primary'];
  if (!layer || !layer.children || !layer.children.section) {
    console.log('No timing tree available for primary layer');
    process.exit(0);
  }
  const secs = Object.keys(layer.children.section).map(k => Number(k)).sort((a, b) => a - b);
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
})();
