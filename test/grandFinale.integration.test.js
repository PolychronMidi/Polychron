const fs = require('fs');
const path = require('path');
const TEST = require('../src/test-setup');
const grandFinale = require('../src/grandFinale');
const MasterMap = require('../src/masterMap');

describe('grandFinale integration', () => {
  beforeEach(() => {
    // reset master map and remove only test-generated files to avoid interfering with parallel tests
    MasterMap.reset();
    try { fs.unlinkSync(path.join(process.cwd(), 'output', 'output1.csv')); } catch (e) { /* swallow */ }
    try { fs.unlinkSync(path.join(process.cwd(), 'output', 'unitMasterMap.json')); } catch (e) { /* swallow */ }
    try { fs.unlinkSync(path.join(process.cwd(), 'output', 'unitMasterMap.ndjson')); } catch (e) { /* swallow */ }
    TEST.LM = { layers: { primary: { state: { units: [] }, buffer: [ { tick: 10, type: 'marker_t', vals: ['unitRec:primary|section1|phrase1|10-20|0.000000-1.000000'] }, { tick: 12, type: 'on', vals: ['60'], _tickSortKey: 12 } ] } } };
  });

  afterEach(() => {
    // cleanup
    TEST.LM = undefined;
    try { fs.unlinkSync(path.join(process.cwd(), 'output', 'output1.csv')); } catch (e) { /* swallow */ }
    try { fs.unlinkSync(path.join(process.cwd(), 'output', 'unitMasterMap.json')); } catch (e) { /* swallow */ }
    try { fs.unlinkSync(path.join(process.cwd(), 'output', 'unitMasterMap.ndjson')); } catch (e) { /* swallow */ }
    MasterMap.reset();
  });

  test('writes output CSV and master map files', () => {
    grandFinale();
    const out1 = path.join(process.cwd(), 'output', 'output1.csv');
    const mm = path.join(process.cwd(), 'output', 'unitMasterMap.json');
    expect(fs.existsSync(out1)).toBe(true);
    const txt = fs.readFileSync(out1, 'utf8');
    expect(txt.indexOf('marker_t') !== -1).toBe(true);
    // finalize already called by grandFinale; ensure master map file exists
    expect(fs.existsSync(mm)).toBe(true);
    const mtxt = fs.readFileSync(mm, 'utf8');
    expect(mtxt.length).toBeGreaterThan(0);
  });
});
