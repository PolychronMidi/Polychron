import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

it('no subsubdivision overlaps reported by treewalker', () => {
  const outDir = path.join(process.cwd(), 'output');
  const reportPath = path.join(outDir, 'treewalker-report.json');

  // Run a fast play and treewalker verification
  execSync(process.execPath + ' src/play.js', { env: Object.assign({}, process.env, { PLAY_LIMIT: '1' }), stdio: 'ignore' });
  try {
    execSync(process.execPath + ' scripts/test/treewalker.js', { stdio: 'ignore' });
  } catch (e) {
    // treewalker may exit non-zero when it finds errors; the report file should still be produced
  }

  expect(fs.existsSync(reportPath)).toBe(true);
  const rpt = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const errors = Array.isArray(rpt.errors) ? rpt.errors : [];
  const subsubErrors = errors.filter(e => typeof e === 'string' && e.includes('unitType subsubdivision'));
  expect(subsubErrors.length).toBe(0);
}, 120000);
