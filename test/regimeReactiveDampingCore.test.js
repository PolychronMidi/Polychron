// First automated test in Polychron.
// Tests the pure computation functions extracted from regimeReactiveDamping.
// Run: node test/regimeReactiveDampingCore.test.js

'use strict';

// Load just the core module — no conductor, no globals, no side effects.
require('../src/utils');  // validator, clamp
require('../src/conductor/signal/profiling/regimeReactiveDampingCore');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function assertClose(actual, expected, tolerance, msg) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg} (got ${actual}, expected ${expected} ±${tolerance})`); }
}

//  tensionShapeCurve ─

console.log('tensionShapeCurve:');

assert(regimeReactiveDampingCore.tensionShapeCurve('flat', 0.0) === 0.5, 'flat at 0 = 0.5');
assert(regimeReactiveDampingCore.tensionShapeCurve('flat', 0.5) === 0.5, 'flat at 0.5 = 0.5');
assert(regimeReactiveDampingCore.tensionShapeCurve('flat', 1.0) === 0.5, 'flat at 1 = 0.5');

assertClose(regimeReactiveDampingCore.tensionShapeCurve('ascending', 0.0), 0.0, 0.001, 'ascending at 0');
assertClose(regimeReactiveDampingCore.tensionShapeCurve('ascending', 0.5), 0.5, 0.001, 'ascending at 0.5');
assertClose(regimeReactiveDampingCore.tensionShapeCurve('ascending', 1.0), 1.0, 0.001, 'ascending at 1');

// arch peaks at 0.5
assertClose(regimeReactiveDampingCore.tensionShapeCurve('arch', 0.0), 0.0, 0.001, 'arch at 0');
assertClose(regimeReactiveDampingCore.tensionShapeCurve('arch', 0.5), 1.0, 0.001, 'arch at 0.5 = peak');
assertClose(regimeReactiveDampingCore.tensionShapeCurve('arch', 1.0), 0.0, 0.01, 'arch at 1 ≈ 0');

// sawtooth resets 3x per piece
assertClose(regimeReactiveDampingCore.tensionShapeCurve('sawtooth', 0.0), 0.0, 0.001, 'sawtooth at 0');
assert(regimeReactiveDampingCore.tensionShapeCurve('sawtooth', 0.32) > 0.9, 'sawtooth near first peak');

// erratic is bounded
const erratic = regimeReactiveDampingCore.tensionShapeCurve('erratic', 0.5);
assert(erratic > -1 && erratic < 2, 'erratic is bounded');

//  scaleByTarget ─

console.log('scaleByTarget:');

assertClose(regimeReactiveDampingCore.scaleByTarget(0.12, 0.80, 0.80), 0.12, 0.001, 'neutral = no change');
assertClose(regimeReactiveDampingCore.scaleByTarget(0.12, 0.45, 0.80), 0.0675, 0.001, 'atmospheric ceiling scales down');
assertClose(regimeReactiveDampingCore.scaleByTarget(0.12, 0.95, 0.80), 0.1425, 0.001, 'chaotic ceiling scales up');
assertClose(regimeReactiveDampingCore.scaleByTarget(0.12, 0, 0.80), 0, 0.001, 'zero target = zero');
assert(regimeReactiveDampingCore.scaleByTarget(0.12, 0.5, 0) === 0.12, 'zero reference = fallback');

//  equilibratorCorrection

console.log('equilibratorCorrection:');

const eq1 = regimeReactiveDampingCore.equilibratorCorrection(
  { exploring: 0.50, coherent: 0.30, evolving: 0.20 },
  { exploring: 0.35, coherent: 0.35, evolving: 0.20 },
  0.28
);
assert(eq1.corrD < 0, 'exploring excess → suppress density');
assert(eq1.corrF < 0, 'exploring excess → suppress flicker');

const eq2 = regimeReactiveDampingCore.equilibratorCorrection(
  { exploring: 0.10, coherent: 0.60, evolving: 0.20 },
  { exploring: 0.35, coherent: 0.35, evolving: 0.20 },
  0.28
);
assert(eq2.corrD > 0, 'coherent excess → boost density');

const eq3 = regimeReactiveDampingCore.equilibratorCorrection(
  { exploring: 0.35, coherent: 0.35, evolving: 0.20 },
  { exploring: 0.35, coherent: 0.35, evolving: 0.20 },
  0.28
);
assertClose(eq3.corrD, 0, 0.01, 'on-target → no correction');
assertClose(eq3.corrT, 0, 0.01, 'on-target → no correction');

//  Summary ─

//  metaProfiles.disableAxis
// Requires full conductor load for this section
require('../src/conductor');

console.log('metaProfiles.disableAxis:');

metaProfiles.setActive('chaotic');
const before = metaProfiles.getRegimeTargets();
assert(before.exploring === 0.50, 'chaotic exploring = 0.50');

metaProfiles.disableAxis('regime-budget');
const disabled = metaProfiles.getRegimeTargets();
assertClose(disabled.exploring, 0.333, 0.001, 'disabled → fallback 0.333');
assertClose(disabled.coherent, 0.333, 0.001, 'disabled → fallback 0.333');

metaProfiles.enableAxis('regime-budget');
const restored = metaProfiles.getRegimeTargets();
assert(restored.exploring === 0.50, 'enabled → chaotic exploring restored');

metaProfiles.setActive(null);

//  Summary ─

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
