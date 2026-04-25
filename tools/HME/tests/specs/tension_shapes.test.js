'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Direct test of the tension-shape curve dispatcher. Bypasses the global-
// load chain by extracting the function via require-then-eval. The
// regimeReactiveDampingCore module self-registers as a global at load
// time; the function is exported on the global object.

require('../../../../src/utils');
require('../../../../src/conductor/controllerConfig');
require('../../../../src/conductor/metaProfileDefinitions');
require('../../../../src/conductor/metaProfiles');
require('../../../../src/conductor/signal/profiling/regimeReactiveDampingCore');

const curve = global.regimeReactiveDampingCore.tensionShapeCurve;

test('tensionShapeCurve: flat returns constant 0.5', () => {
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    assert.strictEqual(curve('flat', p), 0.5);
  }
});

test('tensionShapeCurve: ascending returns progress directly', () => {
  assert.strictEqual(curve('ascending', 0), 0);
  assert.strictEqual(curve('ascending', 0.5), 0.5);
  assert.strictEqual(curve('ascending', 1), 1);
});

test('tensionShapeCurve: descending returns 1 - progress', () => {
  assert.strictEqual(curve('descending', 0), 1, 'starts at ceiling');
  assert.strictEqual(curve('descending', 0.5), 0.5);
  assert.strictEqual(curve('descending', 1), 0, 'ends at floor');
  // Any midpoint should be 1 - progress
  assert.strictEqual(curve('descending', 0.25), 0.75);
  assert.strictEqual(curve('descending', 0.75), 0.25);
});

test('tensionShapeCurve: arch (default) is sin(progress * π) — peak at 0.5', () => {
  // Default branch when shape is missing or unknown → arch.
  const peak = curve('arch', 0.5);
  assert.ok(peak > 0.99 && peak <= 1.0, `expected ~1 at 0.5, got ${peak}`);
  assert.ok(curve('arch', 0) < 0.001);
  assert.ok(curve('arch', 1) < 0.001);
});

test('tensionShapeCurve: sawtooth wraps at 1/3 boundaries', () => {
  // (progress * 3) % 1.0
  assert.strictEqual(curve('sawtooth', 0), 0);
  assert.ok(curve('sawtooth', 0.166) > 0.4 && curve('sawtooth', 0.166) < 0.5);
});

test('tensionShapeCurve: erratic returns finite numbers (smoke test)', () => {
  // Erratic uses sin/cos at high frequency; just verify it returns finite
  // values across the range.
  for (let i = 0; i <= 10; i++) {
    const v = curve('erratic', i / 10);
    assert.ok(Number.isFinite(v), `non-finite at progress ${i/10}: ${v}`);
  }
});

test('tensionShapeCurve: unknown shape falls through to arch (default)', () => {
  // Same as arch — sin(progress * π).
  assert.strictEqual(curve('totally-not-a-shape', 0.5), curve('arch', 0.5));
});
