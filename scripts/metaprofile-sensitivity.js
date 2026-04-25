#!/usr/bin/env node
// metaprofile-sensitivity.js -- Aggregate attribution log into per-profile
// outcome statistics. Reads output/metrics/metaprofile-attribution.jsonl
// (the JSONL written by metaProfiles.recordAttribution per section) and
// emits a JSON summary plus a human-readable Markdown table.
//
// Output:
//   output/metrics/metaprofile-sensitivity.json  -- machine-readable
//   stdout                                       -- Markdown summary
//
// This is the closing piece of the empirical-tuning loop:
// recordAttribution opened the data foothold; this aggregator turns
// that JSONL into per-profile mean/std/quantiles + per-section-type
// breakdowns. Later iterations can extend with axis-key sensitivity
// (varying single keys while holding the rest constant) once we have
// enough data points per profile to stratify.

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');
const ATTRIBUTION_FILE = path.join(PROJECT_ROOT, 'output', 'metrics', 'metaprofile-attribution.jsonl');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'output', 'metrics', 'metaprofile-sensitivity.json');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    try { out.push(JSON.parse(lines[i])); }
    catch (err) {
      throw new Error(`metaprofile-sensitivity: ${file}:${i + 1} parse failed: ${err.message}`);
    }
  }
  return out;
}

function quantile(sortedArr, q) {
  if (sortedArr.length === 0) return null;
  const idx = (sortedArr.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function stats(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return { n: 0, mean: null, std: null, min: null, p10: null, p50: null, p90: null, max: null };
  }
  const sorted = finite.slice().sort((a, b) => a - b);
  const sum = finite.reduce((acc, v) => acc + v, 0);
  const mean = sum / finite.length;
  const sqsum = finite.reduce((acc, v) => acc + (v - mean) * (v - mean), 0);
  const std = Math.sqrt(sqsum / finite.length);
  return {
    n: finite.length,
    mean: round(mean, 4),
    std: round(std, 4),
    min: round(sorted[0], 4),
    p10: round(quantile(sorted, 0.10), 4),
    p50: round(quantile(sorted, 0.50), 4),
    p90: round(quantile(sorted, 0.90), 4),
    max: round(sorted[sorted.length - 1], 4),
  };
}

function round(v, digits) {
  if (v === null || v === undefined) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function aggregate(entries) {
  const byProfile = new Map();
  const byProfileSection = new Map();

  for (const e of entries) {
    if (!e.profile) continue;
    if (!byProfile.has(e.profile)) {
      byProfile.set(e.profile, { scores: [], hcis: [] });
    }
    if (Number.isFinite(e.score)) byProfile.get(e.profile).scores.push(e.score);
    if (Number.isFinite(e.hci))   byProfile.get(e.profile).hcis.push(e.hci);

    const k = `${e.profile}:${e.sectionType || '_'}`;
    if (!byProfileSection.has(k)) {
      byProfileSection.set(k, { profile: e.profile, sectionType: e.sectionType || null, scores: [], hcis: [] });
    }
    if (Number.isFinite(e.score)) byProfileSection.get(k).scores.push(e.score);
    if (Number.isFinite(e.hci))   byProfileSection.get(k).hcis.push(e.hci);
  }

  const profiles = {};
  for (const [name, agg] of byProfile.entries()) {
    profiles[name] = { score: stats(agg.scores), hci: stats(agg.hcis) };
  }

  const profileSection = [];
  for (const v of byProfileSection.values()) {
    profileSection.push({
      profile: v.profile,
      sectionType: v.sectionType,
      score: stats(v.scores),
      hci: stats(v.hcis),
    });
  }
  profileSection.sort((a, b) => {
    if (a.profile < b.profile) return -1;
    if (a.profile > b.profile) return 1;
    return (a.sectionType || '').localeCompare(b.sectionType || '');
  });

  const ranking = Object.keys(profiles)
    .filter((p) => profiles[p].score.mean !== null)
    .sort((a, b) => profiles[b].score.mean - profiles[a].score.mean);

  // Coefficient of variation (std / |mean|) flags unstable profiles
  // -- those whose outcome varies wildly relative to their average.
  // Stable profile: cv < 0.15. Volatile: cv > 0.35. Below uses absolute
  // mean to handle near-zero / negative score scales.
  const stability = {};
  for (const name of Object.keys(profiles)) {
    const s = profiles[name].score;
    if (s.n < 2 || s.mean === null || s.mean === 0) {
      stability[name] = { cv: null, label: 'insufficient' };
      continue;
    }
    const cv = round(s.std / Math.abs(s.mean), 4);
    let label = 'stable';
    if (cv > 0.35) label = 'volatile';
    else if (cv > 0.15) label = 'moderate';
    stability[name] = { cv, label };
  }

  return {
    totalEntries: entries.length,
    profileCount: byProfile.size,
    profiles,
    bySection: profileSection,
    rankingByMeanScore: ranking,
    stability,
  };
}

function markdown(report) {
  const lines = [];
  lines.push('# Metaprofile Sensitivity Report');
  lines.push('');
  lines.push(`Source: \`output/metrics/metaprofile-attribution.jsonl\` (${report.totalEntries} entries, ${report.profileCount} profiles)`);
  lines.push('');
  lines.push('## Per-profile score distribution');
  lines.push('');
  lines.push('| Profile | n | mean | std | min | p10 | p50 | p90 | max | hci mean |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const name of report.rankingByMeanScore) {
    const p = report.profiles[name];
    lines.push(`| ${name} | ${p.score.n} | ${p.score.mean ?? '-'} | ${p.score.std ?? '-'} | ${p.score.min ?? '-'} | ${p.score.p10 ?? '-'} | ${p.score.p50 ?? '-'} | ${p.score.p90 ?? '-'} | ${p.score.max ?? '-'} | ${p.hci.mean ?? '-'} |`);
  }
  lines.push('');
  lines.push('## Per-(profile, section) score');
  lines.push('');
  lines.push('| Profile | sectionType | n | mean | p50 | hci mean |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const r of report.bySection) {
    lines.push(`| ${r.profile} | ${r.sectionType ?? '-'} | ${r.score.n} | ${r.score.mean ?? '-'} | ${r.score.p50 ?? '-'} | ${r.hci.mean ?? '-'} |`);
  }
  lines.push('');
  lines.push('## Ranking');
  lines.push('');
  for (let i = 0; i < report.rankingByMeanScore.length; i++) {
    const name = report.rankingByMeanScore[i];
    const meanScore = report.profiles[name].score.mean;
    const stab = report.stability[name];
    const stabTag = stab && stab.cv !== null ? ` _[${stab.label}, cv=${stab.cv}]_` : '';
    lines.push(`${i + 1}. **${name}** (mean score = ${meanScore})${stabTag}`);
  }
  return lines.join('\n');
}

function main() {
  const entries = readJsonl(ATTRIBUTION_FILE);
  if (entries.length === 0) {
    process.stdout.write(`metaprofile-sensitivity: no attribution data at ${ATTRIBUTION_FILE}\n`);
    process.exit(0);
  }
  const report = aggregate(entries);
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  process.stdout.write(markdown(report));
  process.stdout.write('\n');
}

if (require.main === module) {
  main();
}

module.exports = { aggregate, stats, quantile, markdown };
