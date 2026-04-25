'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Load the metaprofile system (self-registers as global).
require('../../../../src/utils');
require('../../../../src/conductor/controllerConfig');
require('../../../../src/conductor/metaProfileDefinitions');
require('../../../../src/conductor/metaProfiles');

const defs = global.metaProfileDefinitions;

test('elegiac: registered + valid axis values', () => {
  const p = defs.get('elegiac');
  assert.ok(p, 'elegiac profile must be registered');
  assert.strictEqual(p.name, 'elegiac');
  // Regime sums to 1.0 (per schema).
  const sum = p.regime.coherent + p.regime.evolving + p.regime.exploring;
  assert.ok(Math.abs(sum - 1.0) < 1e-3, `regime sum ${sum}`);
  // Defining feature: descending tension.
  assert.strictEqual(p.tension.shape, 'descending');
  // Coherent-dominated regime distribution.
  assert.ok(p.regime.coherent > 0.5, 'coherent should dominate');
});

test('elegiac: descending tension floor < ceiling, both in valid range', () => {
  const p = defs.get('elegiac');
  assert.ok(p.tension.floor >= 0 && p.tension.floor < 1);
  assert.ok(p.tension.ceiling > 0 && p.tension.ceiling <= 1);
  assert.ok(p.tension.floor < p.tension.ceiling);
});

test('elegiac: section affinity points at terminal sections only', () => {
  const p = defs.get('elegiac');
  for (const s of p.sectionAffinity) {
    assert.ok(['resolution', 'conclusion', 'coda'].includes(s),
      `unexpected sectionAffinity '${s}' for elegiac`);
  }
});

test('anthemic: registered + locked-step axis signature', () => {
  const p = defs.get('anthemic');
  assert.ok(p, 'anthemic profile must be registered');
  assert.strictEqual(p.tension.shape, 'arch');
  // Defining feature: high coupling midpoint (locked-step).
  assert.ok(p.coupling.midpoint > 0.6, `coupling midpoint ${p.coupling.midpoint}`);
  // High lockBias (synchronized phases).
  assert.ok(p.phase.lockBias > 0.5, `lockBias ${p.phase.lockBias}`);
});

test('anthemic: section affinity is climax + resolution', () => {
  const p = defs.get('anthemic');
  for (const s of p.sectionAffinity) {
    assert.ok(['climax', 'resolution'].includes(s),
      `unexpected sectionAffinity '${s}' for anthemic`);
  }
});

test('bySection includes the new profiles in their declared sections', () => {
  const mp = global.metaProfiles;
  assert.ok(mp.bySection('climax').includes('anthemic'),
    'climax rotation should include anthemic');
  assert.ok(mp.bySection('coda').includes('elegiac'),
    'coda rotation should include elegiac');
  assert.ok(mp.bySection('resolution').includes('anthemic'),
    'resolution rotation should include anthemic');
  assert.ok(mp.bySection('resolution').includes('elegiac'),
    'resolution rotation should include elegiac');
});

test('scaleFactor against new profiles: tension ceiling ratio', () => {
  const mp = global.metaProfiles;
  // Default tension.ceiling is 0.80. Elegiac is 0.55. anthemic is 0.85.
  mp.setActive('elegiac', 0);
  const elegiacRatio = mp.scaleFactor('tension', 'ceiling');
  assert.ok(Math.abs(elegiacRatio - 0.55 / 0.80) < 1e-6,
    `elegiac tension scale ${elegiacRatio} != 0.55/0.80`);

  mp.setActive('anthemic', 0);
  const anthemicRatio = mp.scaleFactor('tension', 'ceiling');
  assert.ok(Math.abs(anthemicRatio - 0.85 / 0.80) < 1e-6,
    `anthemic tension scale ${anthemicRatio} != 0.85/0.80`);

  // Reset to no profile so other tests aren't polluted.
  mp.setActive(null);
});

test('total profile count is now 8 (default + 7 named)', () => {
  const list = defs.list();
  assert.strictEqual(list.length, 8);
  for (const expected of ['default', 'atmospheric', 'tense', 'chaotic', 'meditative', 'volatile', 'elegiac', 'anthemic']) {
    assert.ok(list.includes(expected), `missing: ${expected}`);
  }
});
