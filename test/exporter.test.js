const fs = require('fs');
const path = require('path');
const { run } = require('../scripts/exportUnitTreeJson');

describe('exportUnitTreeJson', () => {
  it('generates unitTreeMap.json with units', () => {
    const outPath = path.join(process.cwd(), 'output', 'unitTreeMap.test.json');
    // ensure a minimal CSV exists so exporter is deterministic
    const outDir = path.join(process.cwd(), 'output');
    try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); } catch (e) { /* swallow */ }
    const sampleCsv = path.join(outDir, 'output1.csv');
    try { fs.writeFileSync(sampleCsv, '1,10,marker_t,unitRec:primary|section1|phrase1|10-20|0.00-1.00\n'); } catch (e) { /* swallow */ }

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
    try { fs.unlinkSync(sampleCsv); } catch (e) { /* swallow */ }
  });
});
