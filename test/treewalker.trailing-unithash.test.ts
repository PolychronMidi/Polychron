import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

test('treewalker accepts trailing unitHash column when it matches manifest and close boundary', () => {
  const outDir = path.resolve(process.cwd(), 'output');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}

  // Write a minimal units.json with a unit that ends at 40320
  const units = [{ unitHash: '145a0jo', unitType: 'beat', layer: 'primary', startTick: 40080, endTick: 40320 }];
  fs.writeFileSync(path.join(outDir, 'units.json'), JSON.stringify({ units }, null, 2));

  // Write a CSV line that contains a trailing unitHash token at the event end tick
  const csv = `0,0,header,1,1,480\n1,0,start_track\n1,40320,control_c,2,7,86,145a0jo\n1,40800,end_track\n`;
  fs.writeFileSync(path.join(outDir, 'output1.csv'), csv);

  // Execute the treewalker script
  try {
    execSync('node scripts/treewalker.js', { stdio: 'inherit' });
  } catch (e) {
    // It's fine if the script returns non-zero; we'll inspect the generated report
  }

  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'treewalker-report.json'), 'utf8'));
  const missing = report.errors.filter((e: string) => e.startsWith('Missing unitHash in output1.csv line'));
  expect(missing.length).toBe(0);
});
