const fs = require('fs');
const path = require('path');
// use Vitest globals (no require) - tests run under Vitest which exposes `test` and `expect` as globals

// Focused consistency check: ensure that poly s0-p0 unitRec-derived starts match marker-derived start (0s) within tolerance
const OUT = path.join(process.cwd(), 'output');
const TOL = 0.02; // match layerAlignment default

function readUnitRecsForLayerPhrase(layer, sectionIdx, phraseIdx) {
  const csv = path.join(OUT, layer === 'primary' ? 'output1.csv' : 'output2.csv');
  if (!fs.existsSync(csv)) return [];
  const lines = fs.readFileSync(csv, 'utf8').split(/\r?\n/);
  const unitRecs = [];
  for (const ln of lines) {
    if (!ln || !ln.startsWith('1,')) continue;
    const parts = ln.split(',');
    if (parts.length < 4) continue;
    if (String(parts[2]).toLowerCase() !== 'marker_t') continue;
    const val = parts.slice(3).join(',');
    const m = String(val).match(/unitRec:([^\s,]+)/);
    if (!m) continue;
    const full = m[1];
    if (full.indexOf(`section${sectionIdx+1}|phrase${phraseIdx+1}`) === -1) continue;
    const seg = full.split('|');
    let startTime = null;
    for (let i = seg.length - 1; i >= 0; i--) {
      const s = seg[i];
      if (/^\d+\.\d+-\d+\.\d+$/.test(s)) { startTime = Number(s.split('-')[0]); break; }
    }
    unitRecs.push({ full, startTime });
  }
  return unitRecs;
}

test('poly s0-p0 unitRec start is aligned to marker start (≈0s)', () => {
  const recs = readUnitRecsForLayerPhrase('poly', 0, 0);
  // require at least one unitRec present
  expect(recs.length).toBeGreaterThan(0);
  // find any rec with explicit seconds; if none, the test will use the minimal interpreted startTime (non-null)
  const explicit = recs.filter(r => r.startTime !== null).map(r => r.startTime);
  if (explicit.length) {
    const min = Math.min(...explicit);
    expect(min).toBeLessThanOrEqual(TOL);
  } else {
    // no explicit times — fail the test to force attention
    throw new Error('No unitRec markers with explicit seconds found for poly s0-p0');
  }
});
