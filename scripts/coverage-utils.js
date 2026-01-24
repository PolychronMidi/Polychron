import fs from 'fs';
import path from 'path';
import stripAnsi from './utils/stripAnsi.js';
import readLogSafe from './utils/readLogSafe.js';
import findFileByName from './utils/findFileByName.js';


/**
 * Parse coverage statistics using various fallbacks (log parse, summary json, final json)
 * @param {string} [projectRoot=process.cwd()] - Project root path to search for logs and coverage files.
 * @returns {{summary:string|null,statements:number|null,branches:number|null,functions:number|null,lines:number|null}}
 */
export function parseCoverageStats(projectRoot = process.cwd()) {
  // 1) Try log parsing
  const raw = readLogSafe(projectRoot, 'coverage.log');
  if (raw && raw.trim()) {
    const clean = stripAnsi(raw);
    const patterns = [
      /^\s*All files\s*\|\s*([0-9.]+)%?\s*\|\s*([0-9.]+)%?\s*\|\s*([0-9.]+)%?\s*\|\s*([0-9.]+)%?/im,
      /All files[\s\S]*?(?:\s|\|)([0-9.]+)%?.*?(?:\s|\|)([0-9.]+)%?.*?(?:\s|\|)([0-9.]+)%?.*?(?:\s|\|)([0-9.]+)%?/im,
      /\bAll files\b.*?([0-9.]+)\s*%.*?([0-9.]+)\s*%.*?([0-9.]+)\s*%.*?([0-9.]+)\s*%/im
    ];
    for (const pat of patterns) {
      const m = clean.match(pat);
      if (m) {
        const statements = Math.round(Number(m[1]) * 10) / 10;
        const branches = Math.round(Number(m[2]) * 10) / 10;
        const functions = Math.round(Number(m[3]) * 10) / 10;
        const lines = Math.round(Number(m[4]) * 10) / 10;
        return { summary: null, statements, branches, functions, lines };
      }
    }
  }

  // 2) JSON summary - try common locations and falling back to searching the tree.
  const summaryCandidates = [
    path.join(projectRoot, 'coverage', 'coverage-summary.json'),
    path.join(projectRoot, 'coverage-summary.json'),
    path.join(projectRoot, 'coverage', 'coverage', 'coverage-summary.json')
  ];
  let summaryPath = summaryCandidates.find(p => fs.existsSync(p));
  if (!summaryPath) summaryPath = findFileByName(projectRoot, 'coverage-summary.json', 4);
  if (summaryPath && fs.existsSync(summaryPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      if (j && j.total) {
        const statements = Math.round((j.total.statements.pct || 0) * 10) / 10;
        const branches = Math.round((j.total.branches.pct || 0) * 10) / 10;
        const functions = Math.round((j.total.functions.pct || 0) * 10) / 10;
        const lines = Math.round((j.total.lines.pct || 0) * 10) / 10;
        return { summary: null, statements, branches, functions, lines };
      }
    } catch (e) {
      // ignore parse errors and continue to other strategies
    }
  }

  // 3) Fallback compute from coverage-final.json - search common and nested locations
  const finalCandidates = [
    path.join(projectRoot, 'coverage', 'coverage-final.json'),
    path.join(projectRoot, 'coverage-final.json'),
    path.join(projectRoot, 'coverage', 'coverage', 'coverage-final.json')
  ];
  let finalPath = finalCandidates.find(p => fs.existsSync(p));
  if (!finalPath) finalPath = findFileByName(projectRoot, 'coverage-final.json', 4);
  if (finalPath && fs.existsSync(finalPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
      let stmtTotal = 0, stmtCovered = 0;
      let funcTotal = 0, funcCovered = 0;
      let branchTotal = 0, branchCovered = 0;
      for (const k of Object.keys(j)) {
        const ent = j[k];
        if (ent.s) {
          const sKeys = Object.keys(ent.s || {});
          stmtTotal += sKeys.length;
          for (const id of sKeys) if ((ent.s[id] || 0) > 0) stmtCovered++;
        }
        if (ent.f) {
          const fKeys = Object.keys(ent.f || {});
          funcTotal += fKeys.length;
          for (const id of fKeys) if ((ent.f[id] || 0) > 0) funcCovered++;
        }
        if (ent.b) {
          for (const id of Object.keys(ent.b || {})) {
            const arr = ent.b[id] || [];
            branchTotal += arr.length;
            for (const v of arr) if (v > 0) branchCovered++;
          }
        }
      }
      const statements = stmtTotal ? Math.round((stmtCovered / stmtTotal) * 1000) / 10 : null;
      const functions = funcTotal ? Math.round((funcCovered / funcTotal) * 1000) / 10 : null;
      const branches = branchTotal ? Math.round((branchCovered / branchTotal) * 1000) / 10 : null;
      const lines = statements;
      if (statements !== null) return { summary: null, statements, branches, functions, lines };
    } catch (e) {
      // ignore parse errors
    }
  }

  return { summary: 'Coverage data unavailable', statements: null, branches: null, functions: null, lines: null };
}

// If run as a CLI helper, perform self-tests to validate parsing under Node (used by Vitest spawn)
if (process.argv.includes('--self-test')) {
  try {
    const tmpRoot = path.join(process.cwd(), '.tmp-coverage-selftest');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });

    // case 1: log parsing
    fs.mkdirSync(path.join(tmpRoot, 'log'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'log', 'coverage.log'), 'All files | 74.69 | 56.95 | 74.21 | 75.43');
    const c1 = parseCoverageStats(tmpRoot);
    if (!c1 || c1.lines !== 75.4) throw new Error('log parse failed: ' + JSON.stringify(c1));
    // remove log so subsequent cases test other code paths
    fs.rmSync(path.join(tmpRoot, 'log'), { recursive: true, force: true });

    // case 2: summary JSON
    fs.mkdirSync(path.join(tmpRoot, 'coverage'), { recursive: true });
    const summary = { total: { statements: { pct: 74.6 }, branches: { pct: 56.9 }, functions: { pct: 74 }, lines: { pct: 75.4 } } };
    fs.writeFileSync(path.join(tmpRoot, 'coverage', 'coverage-summary.json'), JSON.stringify(summary));
    const c2 = parseCoverageStats(tmpRoot);
    if (!c2 || c2.statements !== 74.6) throw new Error('summary parse failed: ' + JSON.stringify(c2));
    // remove coverage summary so final.json compute is exercised
    fs.rmSync(path.join(tmpRoot, 'coverage'), { recursive: true, force: true });

    // case 3: final JSON compute
    fs.mkdirSync(path.join(tmpRoot, 'coverage'), { recursive: true });
    const final = { 'file1.js': { s: { '1': 1, '2': 0 }, f: { '1': 1 }, b: { '1': [1, 0] } } };
    fs.writeFileSync(path.join(tmpRoot, 'coverage', 'coverage-final.json'), JSON.stringify(final));
    const c3 = parseCoverageStats(tmpRoot);
    if (!c3 || c3.statements !== 50) throw new Error('final compute failed: ' + JSON.stringify(c3));

    fs.rmSync(tmpRoot, { recursive: true, force: true });
    console.log('SELF-TEST: OK');
    process.exit(0);
  } catch (e) {
    console.error('SELF-TEST: FAILED', e && e.stack ? e.stack : e);
    process.exit(1);
  }
}
