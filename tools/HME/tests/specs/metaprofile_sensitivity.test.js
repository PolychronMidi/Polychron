'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const { aggregate, stats, quantile, markdown } = require('../../../../scripts/metaprofile-sensitivity.js');

test('quantile: handles single-element array', () => {
  assert.strictEqual(quantile([5], 0), 5);
  assert.strictEqual(quantile([5], 0.5), 5);
  assert.strictEqual(quantile([5], 1), 5);
});

test('quantile: linear interpolation between elements', () => {
  // [10, 20, 30] -- p50 = 20, p25 = 15, p75 = 25
  assert.strictEqual(quantile([10, 20, 30], 0.5), 20);
  assert.strictEqual(quantile([10, 20, 30], 0.25), 15);
  assert.strictEqual(quantile([10, 20, 30], 0.75), 25);
});

test('quantile: empty array returns null', () => {
  assert.strictEqual(quantile([], 0.5), null);
});

test('stats: empty values returns null fields', () => {
  const s = stats([]);
  assert.strictEqual(s.n, 0);
  assert.strictEqual(s.mean, null);
  assert.strictEqual(s.std, null);
});

test('stats: filters non-finite values', () => {
  const s = stats([1, 2, 3, NaN, undefined, null, 4]);
  assert.strictEqual(s.n, 4);
  assert.strictEqual(s.mean, 2.5);
});

test('stats: mean/std/quantiles for known input', () => {
  const s = stats([1, 2, 3, 4, 5]);
  assert.strictEqual(s.n, 5);
  assert.strictEqual(s.mean, 3);
  // population std of [1,2,3,4,5] = sqrt(2) ~ 1.4142
  assert.ok(Math.abs(s.std - Math.sqrt(2)) < 1e-3);
  assert.strictEqual(s.min, 1);
  assert.strictEqual(s.max, 5);
  assert.strictEqual(s.p50, 3);
});

test('aggregate: groups by profile and computes per-profile stats', () => {
  const entries = [
    { profile: 'atmospheric', sectionType: 'intro', score: 0.8, hci: 90 },
    { profile: 'atmospheric', sectionType: 'intro', score: 0.9, hci: 92 },
    { profile: 'chaotic', sectionType: 'climax', score: 0.5, hci: 85 },
  ];
  const r = aggregate(entries);
  assert.strictEqual(r.totalEntries, 3);
  assert.strictEqual(r.profileCount, 2);
  assert.strictEqual(r.profiles.atmospheric.score.n, 2);
  assert.strictEqual(r.profiles.atmospheric.score.mean, 0.85);
  assert.strictEqual(r.profiles.chaotic.score.n, 1);
  assert.strictEqual(r.profiles.chaotic.score.mean, 0.5);
});

test('aggregate: ranking sorted by mean score descending', () => {
  const entries = [
    { profile: 'low', sectionType: 'intro', score: 0.3 },
    { profile: 'high', sectionType: 'intro', score: 0.9 },
    { profile: 'mid', sectionType: 'intro', score: 0.6 },
  ];
  const r = aggregate(entries);
  assert.deepStrictEqual(r.rankingByMeanScore, ['high', 'mid', 'low']);
});

test('aggregate: by-section breakdown stratifies correctly', () => {
  const entries = [
    { profile: 'p', sectionType: 'intro', score: 0.5 },
    { profile: 'p', sectionType: 'climax', score: 0.9 },
    { profile: 'p', sectionType: 'intro', score: 0.7 },
  ];
  const r = aggregate(entries);
  assert.strictEqual(r.bySection.length, 2);
  const intro = r.bySection.find((x) => x.sectionType === 'intro');
  const climax = r.bySection.find((x) => x.sectionType === 'climax');
  assert.strictEqual(intro.score.n, 2);
  assert.strictEqual(intro.score.mean, 0.6);
  assert.strictEqual(climax.score.n, 1);
  assert.strictEqual(climax.score.mean, 0.9);
});

test('aggregate: handles entries missing score or hci', () => {
  const entries = [
    { profile: 'p', sectionType: 'intro' },                     // both missing
    { profile: 'p', sectionType: 'intro', score: 0.5 },         // hci missing
    { profile: 'p', sectionType: 'intro', score: 0.7, hci: 88 },// both present
  ];
  const r = aggregate(entries);
  assert.strictEqual(r.profiles.p.score.n, 2);
  assert.strictEqual(r.profiles.p.hci.n, 1);
});

test('aggregate: skips entries with no profile name', () => {
  const entries = [
    { sectionType: 'intro', score: 0.5 },
    { profile: 'p', sectionType: 'intro', score: 0.7 },
  ];
  const r = aggregate(entries);
  assert.strictEqual(r.profileCount, 1);
  assert.strictEqual(r.profiles.p.score.n, 1);
});

test('markdown: renders a complete report', () => {
  const entries = [
    { profile: 'p', sectionType: 'intro', score: 0.5, hci: 90 },
  ];
  const md = markdown(aggregate(entries));
  assert.ok(md.includes('# Metaprofile Sensitivity Report'));
  assert.ok(md.includes('| p |'));
  assert.ok(md.includes('Ranking'));
});
