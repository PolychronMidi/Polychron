#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const candidates = [
  path.join(root, 'coverage', 'coverage-final.json'),
  path.join(root, 'coverage-final.json')
];
const finalPath = candidates.find(p => fs.existsSync(p));
if (!finalPath) {
  console.error('coverage-final.json not found in expected locations');
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(finalPath, 'utf8'));

function computeBranchStats(ent) {
  let branchTotal = 0, branchCovered = 0;
  if (ent.b) {
    for (const id of Object.keys(ent.b || {})) {
      const arr = ent.b[id] || [];
      branchTotal += arr.length;
      for (const v of arr) if (v > 0) branchCovered++;
    }
  }

  let stmtTotal = 0, stmtCovered = 0;
  if (ent.s) {
    for (const id of Object.keys(ent.s || {})) {
      stmtTotal++;
      if ((ent.s[id] || 0) > 0) stmtCovered++;
    }
  }

  const branchPct = branchTotal ? Math.round((branchCovered / branchTotal) * 1000) / 10 : null;
  const stmtPct = stmtTotal ? Math.round((stmtCovered / stmtTotal) * 1000) / 10 : null;
  return { branchTotal, branchCovered, branchPct, stmtTotal, stmtCovered, stmtPct };
}

const entries = Object.keys(j).map(k => {
  const ent = j[k];
  const stats = computeBranchStats(ent);
  return { path: k, ...stats };
});

const withBranches = entries.filter(e => e.branchTotal > 0);
const sorted = withBranches.sort((a, b) => (a.branchPct === null ? 100 : a.branchPct) - (b.branchPct === null ? 100 : b.branchPct));

const topN = 20;
const top = sorted.slice(0, topN);

const outLines = [];
outLines.push('# Branch Coverage Prioritized TODOs');
outLines.push('');
outLines.push(`Generated: ${new Date().toISOString()}`);
outLines.push('');
outLines.push('Files with lowest branch coverage (lowest first):');
outLines.push('');
for (const e of top) {
  const filePath = e.path.replace(/\\/g, '/');
  const pct = e.branchPct === null ? 'N/A' : e.branchPct + '%';
  outLines.push('- [ ] `' + filePath + '` — branch coverage: ' + pct + ' (' + e.branchCovered + '/' + e.branchTotal + ')');
}

outLines.push('');
outLines.push('---');
outLines.push('Guidance: Create focused integration tests that exercise conditional branches, invalid inputs, and edge cases. Prefer real implementations (no mocks) per Test Protocol.');

const md = outLines.join('\n');
const outPath = path.join(root, 'TODO-branch-coverage.md');
fs.writeFileSync(outPath, md, 'utf8');

console.log(`Wrote: ${outPath}`);
console.log('Top files:');
for (const e of top) console.log(`${e.branchPct === null ? 'N/A' : e.branchPct + '%'} - ${e.path} (${e.branchCovered}/${e.branchTotal})`);

process.exit(0);
