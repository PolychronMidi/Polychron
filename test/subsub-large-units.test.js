import { expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

it('finds subsubdivision units with span > 60000 in LM state for diagnosis', () => {
  process.env.PLAY_LIMIT = '1';
  execSync(process.execPath + ' src/play.js', { env: Object.assign({}, process.env, { PLAY_LIMIT: '1', SUPPRESS_HUMAN_MARKER_CHECK: '1' }), stdio: 'inherit' });
  execSync(process.execPath + ' scripts/exportUnitTreeJson.js', { stdio: 'ignore' });
  const ut = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'unitTreeMap.json'), 'utf8'));
  const units = ut.units || [];
  const large = [];
  for (const u of units) {
    // Prefer detecting by part name tokens
    const parts = (u.parts || []).map(String).join('|');
    if (parts.indexOf('subsubdivision') !== -1 || u.key && String(u.key).indexOf('subsubdivision') !== -1) {
      const span = (typeof u.endTick === 'number' && typeof u.startTick === 'number') ? (u.endTick - u.startTick) : null;
      if (span !== null && span > 60000) {
        large.push({ key: u.key, start: u.startTick, end: u.endTick, span, layer: u.layer });
      }
    }
  }
  // Print diagnostics to help developer triage
  large.forEach(l => console.log('LARGE_UNIT', l));
  expect(large.length).toBe(0);
});
