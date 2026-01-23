import * as fs from 'fs';
import * as path from 'path';

describe('Output file format', () => {
  const parseLine = (line: string) => line.split(',');

  it('CSV rows should start with numeric track and tick and have a type', () => {
    const csvPath = path.join(__dirname, '..', 'output', 'output1.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(0, 500);
    for (const ln of lines) {
      const cols = parseLine(ln);
      expect(cols.length).toBeGreaterThanOrEqual(3);
      const track = Number(cols[0]);
      const tick = Number(cols[1]);
      const type = cols[2];
      expect(Number.isFinite(track)).toBe(true);
      expect(Number.isFinite(tick)).toBe(true);
      expect(typeof type).toBe('string');
      if (String(type).toLowerCase().includes('on')) {
        // Ensure there are at least two vals (channel, note) following type
        expect(cols.length).toBeGreaterThanOrEqual(5);
        const ch = Number(cols[3]);
        const note = Number(cols[4]);
        expect(Number.isFinite(ch)).toBe(true);
        expect(Number.isFinite(note)).toBe(true);
      }
    }
  });
});
