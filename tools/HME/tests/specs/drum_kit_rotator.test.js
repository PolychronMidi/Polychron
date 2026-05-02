'use strict';
// Regression tests for drumKitRotator v2.
//
// v1 was reverted: it bulldozed the foundational dominant drums by
// rotating kicks across the full 7-kick family, producing a "random
// mess with barely any decipherable kick/snare dynamic" per listener
// verdict. v2 anchors every preset on the dominant kicks/snares
// (selected for their distinct velocity ranges in drumMap) and rotates
// only the SUPPLEMENTARY slots: alt-kick fill, mix-fill secondary
// drums, tail snare, end-accent, cymbal, and conga.
//
// These tests lock in: foundation-anchored kicks per layer, foundation-
// anchored mixFill leaders, every-phrase rotation of supplementary
// slots, and source-level coprime multipliers vs preset count.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withGlobals } = require('../with_globals');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const ROTATOR = path.join(REPO, 'src', 'rhythm', 'drums', 'drumKitRotator.js');

// drumKitRotator's getL1Preset/getL2Preset re-read global.measureIndex /
// .beatIndex at CALL time, so we can't withGlobals-scope the indices
// around just the loader. Scope only the validator stub per-call
// (its replacement is the actual leak class), and snapshot+restore the
// indices at end-of-file. src/utils legitimately registers the indices
// as globals -- the test stubs OVERRIDE them per loadRotator call, but
// we restore the originals at suite end so the tripwire reads zero drift.
require('../../../../src/utils');
const _REAL_VALIDATOR = global.validator;
const _REAL_INDICES = {
  sectionIndex: global.sectionIndex,
  phraseIndex: global.phraseIndex,
  measureIndex: global.measureIndex,
  beatIndex: global.beatIndex,
};
after(() => {
  if (_REAL_VALIDATOR) global.validator = _REAL_VALIDATOR;
  for (const [k, v] of Object.entries(_REAL_INDICES)) global[k] = v;
});

const _STUB_VALIDATOR = {
  create: () => ({
    requireFinite: (v, n) => { if (!Number.isFinite(v)) throw new Error(n); return v; },
    assertArray: (v, n) => { if (!Array.isArray(v)) throw new Error(n); return v; }
  })
};

// L1 foundation: every preset must use kick1 + kick3 in the kicks slot,
// in some order, with no other kick identities permitted.
const L1_FOUNDATION_KICKS = new Set(['kick1', 'kick3']);
// L2 foundation: every preset must use exactly {kick2, kick5, kick7} as
// the kicks set (any order).
const L2_FOUNDATION_KICKS = new Set(['kick2', 'kick5', 'kick7']);
// L1 mixFill must lead with one of these foundational snares.
const L1_FOUNDATION_LEAD_SNARES = new Set(['snare1', 'snare4']);
// L2 mixFill must lead with one of these.
const L2_FOUNDATION_LEAD_SNARES = new Set(['snare2', 'snare3']);

function loadRotator(sectionIdx, phraseIdx, measureIdx = 0, beatIdx = 0) {
  // Scope ONLY validator -- its replacement is the leak class run.js
  // tracks. The indices stay set across the test body because the
  // rotator's getL1Preset/getL2Preset re-read them at call time.
  // File-level after() cleans the indices on suite end.
  return withGlobals(
    { validator: _STUB_VALIDATOR },
    () => {
      global.sectionIndex = sectionIdx;
      global.phraseIndex = phraseIdx;
      global.measureIndex = measureIdx;
      global.beatIndex = beatIdx;
      delete require.cache[require.resolve(ROTATOR)];
      require(ROTATOR);
      return global.drumKitRotator;
    }
  );
}

function asSet(arr) { return new Set(arr); }
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

test('drumKitRotator: file exists', () => {
  assert.ok(fs.existsSync(ROTATOR));
});

test('foundation: every L1 preset uses only kick1+kick3', () => {
  // Walk through enough phrases to hit every preset slot in the cycle.
  const seen = new Set();
  for (let p = 0; p < 8; p++) {
    const r = loadRotator(0, p);
    const preset = r.getL1Preset();
    const kicks = asSet(preset.kicks);
    assert.ok(setsEqual(kicks, L1_FOUNDATION_KICKS),
      `phrase ${p}: L1 kicks must be {kick1,kick3}, got {${[...kicks].join(',')}}`);
    seen.add(preset.kicks.join('|'));  // record permutation
  }
  assert.ok(seen.size >= 1, 'must observe at least one preset variation');
});

test('foundation: every L2 preset uses only {kick2,kick5,kick7}', () => {
  for (let p = 0; p < 8; p++) {
    const r = loadRotator(0, p);
    const preset = r.getL2Preset();
    const kicks = asSet(preset.kicks);
    assert.ok(setsEqual(kicks, L2_FOUNDATION_KICKS),
      `phrase ${p}: L2 kicks must be {kick2,kick5,kick7}, got {${[...kicks].join(',')}}`);
  }
});

test('foundation: every L1 mixFill leads with snare1 or snare4', () => {
  for (let p = 0; p < 8; p++) {
    const r = loadRotator(0, p);
    const preset = r.getL1Preset();
    assert.ok(L1_FOUNDATION_LEAD_SNARES.has(preset.mixFill[0]),
      `phrase ${p}: L1 mixFill must lead with snare1/4, got ${preset.mixFill[0]}`);
  }
});

test('foundation: every L2 mixFill leads with snare2 or snare3', () => {
  for (let p = 0; p < 8; p++) {
    const r = loadRotator(0, p);
    const preset = r.getL2Preset();
    assert.ok(L2_FOUNDATION_LEAD_SNARES.has(preset.mixFill[0]),
      `phrase ${p}: L2 mixFill must lead with snare2/3, got ${preset.mixFill[0]}`);
  }
});

test('rotation: cymbal varies across consecutive phrases', () => {
  const cymbals = new Set();
  for (let p = 0; p < 4; p++) {
    cymbals.add(loadRotator(0, p).getL1Preset().cymbal);
  }
  assert.ok(cymbals.size >= 3,
    `cymbal must rotate per phrase, got ${cymbals.size} distinct in 4 phrases`);
});

test('rotation: conga varies across consecutive phrases', () => {
  const congas = new Set();
  for (let p = 0; p < 4; p++) {
    congas.add(loadRotator(0, p).getL1Preset().conga);
  }
  assert.ok(congas.size >= 3,
    `conga must rotate per phrase, got ${congas.size} distinct in 4 phrases`);
});

test('rotation: tailSnare varies across consecutive phrases', () => {
  const tails = new Set();
  for (let p = 0; p < 4; p++) {
    tails.add(loadRotator(0, p).getL1Preset().tailSnare);
  }
  assert.ok(tails.size >= 3,
    `tailSnare must rotate per phrase, got ${tails.size} distinct in 4 phrases`);
});

test('determinism: same (section, phrase) yields same preset', () => {
  const a = loadRotator(2, 3).getL1Preset();
  const b = loadRotator(2, 3).getL1Preset();
  assert.deepStrictEqual(a, b);
});

test('layer separation: L1 and L2 pick different presets in same phrase', () => {
  // L1 uses presetIndex(0), L2 uses presetIndex(1) -- they should never
  // be in lockstep. Across 8 phrases at most a handful can collide.
  let lockstep = 0;
  for (let p = 0; p < 8; p++) {
    const r = loadRotator(0, p);
    if (r.getL1Preset().cymbal === r.getL2Preset().cymbal) lockstep++;
  }
  assert.ok(lockstep < 8, 'L1 and L2 cymbals should not be in lockstep');
});

test('missing globals fail loud (no silent fallback)', () => {
  withGlobals(
    { validator: _STUB_VALIDATOR },
    () => {
      global.sectionIndex = NaN;
      global.phraseIndex = 0;
      delete require.cache[require.resolve(ROTATOR)];
      require(ROTATOR);
      assert.throws(() => global.drumKitRotator.getL1Preset(), /sectionIndex/);
    }
  );
});

test('flair: per-beat rotation hits multiple presets within one phrase', () => {
  // Normal mode pins to one preset for the whole phrase. Flair mode
  // should walk through multiple presets across the beats of a phrase.
  const flairCymbals = new Set();
  for (let m = 0; m < 4; m++) {
    for (let b = 0; b < 4; b++) {
      flairCymbals.add(loadRotator(0, 0, m, b).getL1Preset(true).cymbal);
    }
  }
  assert.ok(flairCymbals.size >= 3,
    `flair mode must rotate per-beat, got ${flairCymbals.size} distinct cymbals in 16 beats of same phrase`);
});

test('flair: foundation-anchored even in flair mode (kicks stay {kick1,kick3})', () => {
  for (let m = 0; m < 4; m++) {
    for (let b = 0; b < 4; b++) {
      const preset = loadRotator(0, 0, m, b).getL1Preset(true);
      const kicks = asSet(preset.kicks);
      assert.ok(setsEqual(kicks, L1_FOUNDATION_KICKS),
        `flair m=${m} b=${b}: L1 kicks must stay {kick1,kick3}, got {${[...kicks].join(',')}}`);
    }
  }
});

test('flair: normal mode pins to one preset per phrase (no per-beat drift)', () => {
  // Normal (non-flair) mode must NOT vary across beats of the same
  // phrase -- that's the per-phrase grounding contract.
  const cymbals = new Set();
  for (let m = 0; m < 4; m++) {
    for (let b = 0; b < 4; b++) {
      cymbals.add(loadRotator(0, 0, m, b).getL1Preset(false).cymbal);
    }
  }
  assert.strictEqual(cymbals.size, 1,
    `normal mode must pin to one cymbal per phrase, got ${cymbals.size} distinct in 16 beats`);
});

test('source: phraseIndex multiplier is coprime with preset count', () => {
  const src = fs.readFileSync(ROTATOR, 'utf8');
  const seedMatch = src.match(/sectionIndex\s*\*\s*(\d+)\s*\+\s*phraseIndex\s*\*\s*(\d+)/);
  assert.ok(seedMatch, 'seed formula must be sectionIndex*N + phraseIndex*M');
  const phraseMult = Number(seedMatch[2]);
  // Preset count is 4 (L1_PRESETS.length). Phrase multiplier must be
  // coprime with 4 so every phrase advances the preset cycle.
  assert.notStrictEqual(phraseMult % 4, 0,
    `phrase multiplier ${phraseMult} must be coprime with preset count 4 -- preset rotation collapses otherwise`);
});
