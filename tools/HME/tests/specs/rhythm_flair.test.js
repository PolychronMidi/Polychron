'use strict';
// Regression tests for the rhythm-side flair wins:
//   - setRhythm.js: phrase-rotated density baseline + per-call flair multiplier
//   - rhythmValues.swingOffset: occasional jitter on top of mechanical swing
//
// Both shipped as the rhythm-module analog of the drum kit rotator. The
// drum win was: stable foundation + per-phrase rotation + occasional
// flair. These tests lock in the same shape for the rhythm module.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withGlobals } = require('../with_globals');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const SET_RHYTHM = path.join(REPO, 'src', 'rhythm', 'setRhythm.js');
const RHYTHM_VALUES = path.join(REPO, 'src', 'rhythm', 'rhythmValues.js');

// rhythmValues.swingOffset() re-reads `rf` and `m` at CALL time, so we
// can't withGlobals-scope them around the loader -- the test body needs
// them visible AFTER load. Validator IS the leak class (its replacement
// breaks unrelated specs); scope just that one per loader call. The
// indices/rf/m are legitimately registered as globals by src/utils --
// our test stubs OVERRIDE them per loadRhythmValues call. After-hook
// restores the real bindings; `_setRfQueue` is test-only so deleted.
require('../../../../src/utils');
const _REAL_VALIDATOR = global.validator;
const _REAL_RF = global.rf;
const _REAL_M = global.m;
after(() => {
  if (_REAL_VALIDATOR) global.validator = _REAL_VALIDATOR;
  if (_REAL_RF) global.rf = _REAL_RF;
  if (_REAL_M) global.m = _REAL_M;
  delete global._setRfQueue;
});

const _STUB_VALIDATOR = {
  create: () => ({
    requireFinite: (v, n) => { if (!Number.isFinite(v)) throw new Error(n); return v; },
    assertArray: (v, n) => { if (!Array.isArray(v)) throw new Error(n); return v; }
  })
};

function loadRhythmValues() {
  return withGlobals(
    { validator: _STUB_VALIDATOR },
    () => {
      let _rfQueue = [];
      global._setRfQueue = (q) => { _rfQueue = q.slice(); };
      global.rf = (a, b) => {
        if (_rfQueue.length > 0) return _rfQueue.shift();
        if (a === undefined) return 0.5;
        if (b === undefined) return a * 0.5;
        return (a + b) / 2;
      };
      global.m = Math;
      delete require.cache[require.resolve(RHYTHM_VALUES)];
      require(RHYTHM_VALUES);
      return global.rhythmValues;
    }
  );
}

test('setRhythm: PHRASE_DENSITY_FACTORS array exists and centers near 1.0', () => {
  const src = fs.readFileSync(SET_RHYTHM, 'utf8');
  const m = src.match(/PHRASE_DENSITY_FACTORS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, 'PHRASE_DENSITY_FACTORS array must be defined');
  const factors = m[1].split(',').map((s) => Number(s.trim()));
  assert.strictEqual(factors.length, 4, 'expected 4 factors');
  for (const f of factors) {
    assert.ok(Number.isFinite(f), `factor ${f} must be finite`);
    assert.ok(f >= 0.85 && f <= 1.20, `factor ${f} must stay in safe band [0.85, 1.20]`);
  }
  const avg = factors.reduce((a, b) => a + b, 0) / factors.length;
  assert.ok(avg >= 0.95 && avg <= 1.10,
    `average factor ${avg} must center near 1.0 to preserve foundation density`);
});

test('setRhythm: hash multipliers coprime with the 4-factor cycle', () => {
  const src = fs.readFileSync(SET_RHYTHM, 'utf8');
  const m = src.match(/sectionIndex\s*\*\s*(\d+)\s*\+\s*phraseIndex\s*\*\s*(\d+)/);
  assert.ok(m, 'phrase hash formula must use sectionIndex*N + phraseIndex*M');
  const [, secMult, phraseMult] = m.map(Number);
  assert.notStrictEqual(secMult % 4, 0, `section multiplier ${secMult} must be coprime with 4`);
  assert.notStrictEqual(phraseMult % 4, 0, `phrase multiplier ${phraseMult} must be coprime with 4`);
});

test('setRhythm: NaN sectionIndex/phraseIndex falls back to 1.0 (no crash)', () => {
  const src = fs.readFileSync(SET_RHYTHM, 'utf8');
  // Must guard with Number.isFinite check before reading the factor.
  assert.match(src, /Number\.isFinite\(sectionIndex\)\s*&&\s*Number\.isFinite\(phraseIndex\)/,
    'must guard density-factor lookup with isFinite() so an unset rhythm pass does not crash');
});

test('setRhythm: clamp guards still wrap the density expression', () => {
  const src = fs.readFileSync(SET_RHYTHM, 'utf8');
  // The clamp(_, 0.1, 0.9) must still surround every random() density call
  // so flair + phrase rotation can never breach the density floor/ceiling.
  const clampedDensities = src.match(/clamp\([^)]+,\s*0\.1,\s*0\.9\)/g) || [];
  assert.ok(clampedDensities.length >= 3,
    `expected 3 clamped densities (div, subdiv, subsubdiv), got ${clampedDensities.length}`);
});

// ---- swingOffset jitter tests ----

test('swingOffset: foundation behavior on most calls (90% baseline path)', () => {
  const rv = loadRhythmValues();
  global._setRfQueue([0.5]);
  const oddBeat = rv.swingOffset(1, 0.4);
  assert.strictEqual(oddBeat, 0.2, 'odd beat with no jitter must be +amount/2');

  global._setRfQueue([0.5]);
  const evenBeat = rv.swingOffset(2, 0.4);
  assert.strictEqual(evenBeat, -0.2, 'even beat with no jitter must be -amount/2');
});

test('swingOffset: jitter fires on ~10% path with bounded magnitude', () => {
  const rv = loadRhythmValues();
  global._setRfQueue([0.05, 0]);
  const result = rv.swingOffset(1, 0.4);
  assert.strictEqual(result, 0.2, 'midpoint jitter (0) leaves base unchanged');

  global._setRfQueue([0.05, 0.4 * 0.25]);
  const upJittered = rv.swingOffset(1, 0.4);
  assert.ok(Math.abs(upJittered - 0.3) < 1e-9,
    `max-up jitter on odd beat: expected 0.3, got ${upJittered}`);

  global._setRfQueue([0.05, -0.4 * 0.25]);
  const downJittered = rv.swingOffset(1, 0.4);
  assert.ok(downJittered > 0,
    `jitter must not invert swing direction; got ${downJittered}`);
});

test('swingOffset: jitter bound never inverts swing direction', () => {
  const rv = loadRhythmValues();
  for (const beat of [1, 2]) {
    for (const jitterTrigger of [0.05]) {
      for (const jitterMag of [-0.4 * 0.25, 0.4 * 0.25]) {
        global._setRfQueue([jitterTrigger, jitterMag]);
        const r = rv.swingOffset(beat, 0.4);
        const expectedSign = (beat % 2 === 1) ? 1 : -1;
        assert.ok(Math.sign(r) === expectedSign,
          `beat ${beat} jitter ${jitterMag}: expected sign ${expectedSign}, got ${r}`);
      }
    }
  }
});

test('swingOffset: invalid amount fails loud', () => {
  const rv = loadRhythmValues();
  assert.throws(() => rv.swingOffset(1, NaN), /amount/);
});
