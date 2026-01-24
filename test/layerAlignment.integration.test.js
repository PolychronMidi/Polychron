const { spawnSync } = require('child_process');
const path = require('path');
// use Vitest globals (no require) - tests run under Vitest which exposes `test` and `expect` as globals

test('layerAlignment produces no phrase mismatches (inspection of report)', () => {
  const script = path.join(process.cwd(), 'scripts', 'test', 'layerAlignment.js');
  const res = spawnSync(process.execPath, [script], { encoding: 'utf8', env: process.env, stdio: 'pipe' });
  // The verifier may return non-zero for track-level problems; to formally assert correctness
  // we inspect the produced report JSON and ensure there are no phrase mismatches.
  const reportPath = path.join(process.cwd(), 'output', 'layerAlignment-report.json');
  expect(require('fs').existsSync(reportPath)).toBe(true);
  const report = JSON.parse(require('fs').readFileSync(reportPath, 'utf8'));
  expect(report.phraseMismatchCount).toBe(0);
  expect(report.markerMismatchCount).toBe(0);
});
