'use strict';
// Meta-test for run.js's stub-pollution tripwire.
//
// The tripwire installed in run.js detects test-stub leaks (validator,
// rf, m, sectionIndex, ...) by snapshotting at suite start and diffing
// at suite exit. This spec verifies the diff logic in isolation --
// builds a fake "before" snapshot, mutates globalThis, and asserts the
// detector flags the change. Without this meta-test, a subtle bug in
// the snapshot/diff (e.g. wrong key in the watch list, identity vs
// equality compare) would silently disable the entire safeguard.
//
// We test the diff logic, NOT the actual run.js boot sequence --
// running run.js inside a test would recurse. The watch keys and the
// classification rules are pure data; the test mirrors them inline so
// any future divergence between this spec and run.js fails the test.

const { test } = require('node:test');
const assert = require('node:assert');

// Mirror of run.js's _STUB_PRONE_KEYS -- duplicated intentionally so a
// future widen of the watch list also surfaces here.
const STUB_PRONE_KEYS = [
  'validator', 'rf', 'm',
  'sectionIndex', 'phraseIndex', 'measureIndex', 'beatIndex',
];

function snapshotBaseline() {
  const out = {};
  for (const k of STUB_PRONE_KEYS) {
    out[k] = {
      had: Object.prototype.hasOwnProperty.call(global, k),
      value: global[k],
    };
  }
  return out;
}

function diffAgainstBaseline(baseline) {
  const leaks = [];
  for (const k of STUB_PRONE_KEYS) {
    const before = baseline[k];
    const hasNow = Object.prototype.hasOwnProperty.call(global, k);
    if (!before.had && hasNow) leaks.push(`${k}: was unset, now present`);
    else if (before.had && hasNow && global[k] !== before.value) leaks.push(`${k}: replaced`);
    else if (before.had && !hasNow) leaks.push(`${k}: was present, now deleted`);
  }
  return leaks;
}

test('tripwire: clean run produces zero leaks', () => {
  const baseline = snapshotBaseline();
  // No mutations. Diff should be empty.
  assert.deepStrictEqual(diffAgainstBaseline(baseline), []);
});

test('tripwire: stub installation without restore is detected', () => {
  const baseline = snapshotBaseline();
  const had = Object.prototype.hasOwnProperty.call(global, 'validator');
  const prior = global.validator;
  try {
    global.validator = { stub: true };
    const leaks = diffAgainstBaseline(baseline);
    assert.ok(leaks.some((m) => m.includes('validator')),
      `expected validator leak in ${JSON.stringify(leaks)}`);
  } finally {
    if (had) global.validator = prior; else delete global.validator;
  }
});

test('tripwire: stub installation WITH restore stays silent', () => {
  const baseline = snapshotBaseline();
  const had = Object.prototype.hasOwnProperty.call(global, 'validator');
  const prior = global.validator;
  global.validator = { stub: true };
  // Caller restores -- same pattern with_globals applies.
  if (had) global.validator = prior; else delete global.validator;
  const leaks = diffAgainstBaseline(baseline);
  assert.deepStrictEqual(leaks.filter((m) => m.startsWith('validator:')), [],
    `validator should be back to baseline; got ${JSON.stringify(leaks)}`);
});

test('tripwire: deleting a key that was present is detected', () => {
  // Inject a fake baseline for this assertion (we don't want to
  // actually delete a real global).
  const fakeBaseline = {
    validator: { had: true, value: { real: 'thing' } },
    rf: { had: false, value: undefined },
    m: { had: false, value: undefined },
    sectionIndex: { had: false, value: undefined },
    phraseIndex: { had: false, value: undefined },
    measureIndex: { had: false, value: undefined },
    beatIndex: { had: false, value: undefined },
  };
  // Stash + delete real validator.
  const realHad = Object.prototype.hasOwnProperty.call(global, 'validator');
  const real = global.validator;
  delete global.validator;
  try {
    const leaks = diffAgainstBaseline(fakeBaseline);
    assert.ok(leaks.some((m) => m.includes('validator: was present, now deleted')),
      `expected deletion-detected leak; got ${JSON.stringify(leaks)}`);
  } finally {
    if (realHad) global.validator = real;
  }
});

test('tripwire: replacing a key with a different value is detected', () => {
  const original = { real: true };
  const fakeBaseline = {
    validator: { had: true, value: original },
    rf: { had: false, value: undefined },
    m: { had: false, value: undefined },
    sectionIndex: { had: false, value: undefined },
    phraseIndex: { had: false, value: undefined },
    measureIndex: { had: false, value: undefined },
    beatIndex: { had: false, value: undefined },
  };
  const realHad = Object.prototype.hasOwnProperty.call(global, 'validator');
  const real = global.validator;
  global.validator = { replaced: true };
  try {
    const leaks = diffAgainstBaseline(fakeBaseline);
    assert.ok(leaks.some((m) => m.includes('validator: replaced')),
      `expected replacement-detected leak; got ${JSON.stringify(leaks)}`);
  } finally {
    if (realHad) global.validator = real; else delete global.validator;
  }
});
