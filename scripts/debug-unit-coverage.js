console.log('debug-unit-coverage: starting');

// Only run this heavy diagnostic when explicitly enabled via env var to avoid accidental slow test runs
if (!process.env.DEBUG_UNIT_COVERAGE) {
  console.log('debug-unit-coverage: disabled. Set DEBUG_UNIT_COVERAGE=1 to enable (or use "npm run test:debug").');
  process.exit(0);
}

// Run a child Node process that imports play.js and prints a compact JSON summary so we don't import play.js into this script
const { spawnSync } = require('child_process');
const childScript = `
(async () => {
  try {
    const mod = './' + ['src','play.js'].join('/');
    const { initializePlayEngine, getCurrentCompositionContext } = await import(mod);
    await initializePlayEngine();
    const ctx = getCurrentCompositionContext();
    const out = { layers: Object.keys(ctx && ctx.LM && ctx.LM.layers ? ctx.LM.layers : {}), timingTreeKeys: Object.keys(ctx && ctx.state && ctx.state.timingTree ? ctx.state.timingTree : {}) };
    console.log(JSON.stringify(out));
  } catch (e) { console.error('CHILD_ERR', e && e.stack ? e.stack : e); process.exit(2); }
})();
`;
const res = spawnSync(process.execPath, ['-e', childScript], { env: process.env, stdio: ['ignore','pipe','inherit'], encoding: 'utf8' });
if (res.error) { console.error('Child execution failed', res.error); process.exit(1); }
if (res.status !== 0) process.exit(res.status);
let parsed;
try {
  parsed = JSON.parse(res.stdout.trim());
  console.log('Child play context summary:', parsed);
} catch (e) {
  console.error('Failed to parse child output', e && e.stack ? e.stack : e, 'stdout:', res.stdout);
  process.exit(2);
}

// Use the parsed summary produced by the child run; for deep inspections run `node -e` diagnostic scripts that import play.js in their own process.
try {
  console.log('Child play context summary (layers, timingTreeKeys):', parsed);
} catch (e) {
  console.error('No child summary available', e && e.stack ? e.stack : e);
}
process.exit(0);
