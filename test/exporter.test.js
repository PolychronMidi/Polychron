const fs = require('fs');
const path = require('path');
const { run } = require('../scripts/exportUnitTreeJson');

describe('exportUnitTreeJson', () => {
  it('generates unitTreeMap.json with units', () => {
    const outPath = path.join(process.cwd(), 'output', 'unitTreeMap.test.json');
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    const res = run({ out: outPath });
    expect(fs.existsSync(outPath)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    expect(payload).toBeDefined();
    expect(Array.isArray(payload.units)).toBe(true);
    // there should be at least one unit discovered from current CSVs
    expect(payload.units.length).toBeGreaterThan(0);
    // cleanup
    try { fs.unlinkSync(outPath); } catch (e) { /* swallow */ }
  });
});
