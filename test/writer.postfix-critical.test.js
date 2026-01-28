// test/writer.postfix-critical.test.js
require('../src/sheet');
require('../src/writer');
const fs = require('fs');

beforeEach(() => {
  // Ensure output directory exists and remove diagnostics file
  const out = require('path').join(process.cwd(), 'output');
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  const diag = require('path').join(out, 'diagnostics', 'postfix-failures.ndjson');
  try { if (fs.existsSync(diag)) fs.unlinkSync(diag); } catch (e) { /* swallow */ }

  // Setup a minimal LM with two layers
  LM = { layers: { primary: { state: { units: [] }, buffer: [] }, poly: { state: { units: [] }, buffer: [] } }, activeLayer: 'primary' };
});

describe('writer critical enforcement', () => {
  test('human-only marker in primary CSV does NOT cause critical error (only mixed markers do)', () => {
    // Write a primary CSV with a human marker (no unitRec token)
    const primaryCsv = '1,100,marker_t,Section 1/1 Length: (0:00.0000 - 0:00.0000) endTick: 0\n';
    fs.writeFileSync(require('path').join(process.cwd(), 'output', 'output1.csv'), primaryCsv, 'utf8');
    // Prior behavior raised CRITICAL for human-only markers; current behavior only raises when both canonical and human-only markers mix
    expect(() => grandFinale()).not.toThrow();
  });

  test('missing canonical unitRec for poly layer causes critical error', () => {
    // primary has a canonical unitRec
    const primaryCsv = '1,0,marker_t,New Section:unitRec:primary|section1/1|phrase1/1|measure1/1|0-100|0.000000-0.100000\n';
    fs.writeFileSync(require('path').join(process.cwd(), 'output', 'output1.csv'), primaryCsv, 'utf8');
    // poly layer has no corresponding units -> grandFinale should throw
    expect(() => grandFinale()).toThrow(/CRITICAL/);
  });

  test('malformed unit id suffix in tick field causes critical error', () => {
    // Add a poly buffer event with malformed suffix (no tick-range)
    LM.layers.poly.buffer = [{ tick: '100|layer2', type: 'note_on_c', vals: [60, 100] }];
    // Ensure primary CSV exists but irrelevant
    fs.writeFileSync(require('path').join(process.cwd(), 'output', 'output1.csv'), '', 'utf8');
    expect(() => grandFinale()).toThrow(/CRITICAL/);
  });
});
