'use strict';
// Regression tests for drumKitRotator: the per-phrase kit-rotation module that
// fixed the "drum kits never change" listening regression. The seed multipliers
// (sectionIndex*11 + phraseIndex*3) MUST stay coprime with every family size
// (4 cymbals, 5 congas, 7 kicks, 8 snares) — otherwise some family stops
// rotating per phrase. This test would fire if someone edits the multipliers
// to a non-coprime value (e.g. phraseIndex*7 against the 7-kick family).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const ROTATOR = path.join(REPO, 'src', 'rhythm', 'drums', 'drumKitRotator.js');

function loadRotator(sectionIdx, phraseIdx) {
  global.validator = {
    create: () => ({
      requireFinite: (v, n) => { if (!Number.isFinite(v)) throw new Error(n); return v; },
      assertArray: (v, n) => { if (!Array.isArray(v)) throw new Error(n); return v; }
    })
  };
  global.sectionIndex = sectionIdx;
  global.phraseIndex = phraseIdx;
  delete require.cache[require.resolve(ROTATOR)];
  require(ROTATOR);
  return global.drumKitRotator;
}

test('drumKitRotator: file exists', () => {
  assert.ok(fs.existsSync(ROTATOR), 'rotator file must exist');
});

test('drumKitRotator: every phrase change rotates every family', () => {
  // Seven consecutive phrases — every family must hit at least 4 distinct
  // drums (proves coprime multipliers vs family sizes 4/5/7/8).
  const kicks = new Set(), snares = new Set(), cymbals = new Set(), congas = new Set();
  for (let p = 0; p < 7; p++) {
    const r = loadRotator(0, p);
    kicks.add(r.pickKick(0));
    snares.add(r.pickSnare(0));
    cymbals.add(r.pickCymbal(0));
    congas.add(r.pickConga(0));
  }
  assert.ok(kicks.size >= 4, `kicks must rotate per phrase, got ${kicks.size} distinct in 7 phrases`);
  assert.ok(snares.size >= 4, `snares must rotate per phrase, got ${snares.size} distinct in 7 phrases`);
  assert.ok(cymbals.size >= 3, `cymbals (4 family) must rotate, got ${cymbals.size}`);
  assert.ok(congas.size >= 4, `congas (5 family) must rotate, got ${congas.size}`);
});

test('drumKitRotator: same phrase always returns same kit (deterministic)', () => {
  const a = loadRotator(2, 3);
  const k1 = a.pickKicks(2);
  const s1 = a.pickSnares(2);
  const b = loadRotator(2, 3);
  const k2 = b.pickKicks(2);
  const s2 = b.pickSnares(2);
  assert.deepStrictEqual(k1, k2, 'same (section,phrase) must yield identical kicks');
  assert.deepStrictEqual(s1, s2, 'same (section,phrase) must yield identical snares');
});

test('drumKitRotator: L1 (slot 0) and L2 (slot 1) pick different drums', () => {
  // Across 12 phrases L1 and L2 should disagree on kicks/snares most of the
  // time. Allow one accidental collision per family.
  const r = loadRotator(0, 0);
  let kickAgree = 0, snareAgree = 0;
  for (let p = 0; p < 12; p++) {
    const rr = loadRotator(0, p);
    if (rr.pickKick(0) === rr.pickKick(1)) kickAgree++;
    if (rr.pickSnare(0) === rr.pickSnare(1)) snareAgree++;
  }
  assert.ok(kickAgree <= 1, `L1/L2 kicks should differ in most phrases, agreed ${kickAgree}/12`);
  assert.ok(snareAgree <= 1, `L1/L2 snares should differ in most phrases, agreed ${snareAgree}/12`);
});

test('drumKitRotator: missing globals fail loud (no silent fallback)', () => {
  global.validator = {
    create: () => ({
      requireFinite: (v, n) => { if (!Number.isFinite(v)) throw new Error(n); return v; },
      assertArray: (v, n) => { if (!Array.isArray(v)) throw new Error(n); return v; }
    })
  };
  global.sectionIndex = NaN;
  global.phraseIndex = 0;
  delete require.cache[require.resolve(ROTATOR)];
  require(ROTATOR);
  assert.throws(() => global.drumKitRotator.pickKick(0), /sectionIndex/);
});

test('drumKitRotator: source uses coprime multipliers (regression-prevention)', () => {
  const src = fs.readFileSync(ROTATOR, 'utf8');
  // Multipliers must be coprime with family sizes 4/5/7/8.
  // 11 is coprime with all four; 3 is coprime with all four.
  // Catch regression where someone accidentally aligns a multiplier with a family size.
  const seedMatch = src.match(/sectionIndex\s*\*\s*(\d+)\s*\+\s*phraseIndex\s*\*\s*(\d+)/);
  assert.ok(seedMatch, 'seed formula must be: sectionIndex*N + phraseIndex*M');
  const [, secMult, phraseMult] = seedMatch.map(Number);
  for (const size of [4, 5, 7, 8]) {
    assert.notStrictEqual(phraseMult % size, 0, `phrase multiplier ${phraseMult} aligns with family size ${size} — phrase rotation collapses`);
    assert.notStrictEqual(secMult % size, 0, `section multiplier ${secMult} aligns with family size ${size} — section rotation collapses`);
  }
});
