import { expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

it('subdiv siblings do not overlap within same parent', () => {
  process.env.PLAY_LIMIT = '1';
  execSync(process.execPath + ' scripts/play-guard.js', { env: Object.assign({}, process.env, { PLAY_LIMIT: '1', SUPPRESS_HUMAN_MARKER_CHECK: '1', PLAY_GUARD_BLOCK: '1' }), stdio: 'inherit' });
  execSync(process.execPath + ' scripts/exportUnitTreeJson.js', { stdio: 'ignore' });
  const ut = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'unitTreeMap.json'), 'utf8'));
  const units = (ut.units || []).filter(u => ((u.parts || []).join('|').indexOf('subdiv') !== -1) || (u.key && String(u.key).indexOf('subdiv') !== -1));
  const violations = [];
  // group by parent (section|phrase|measure|beat|div)
  const groups = {};
  for (const u of units) {
    const key = (u.parts || []).slice(0, -1).join('|');
    groups[key] = groups[key] || [];
    groups[key].push(u);
  }
  for (const k of Object.keys(groups)) {
    const arr = groups[k].sort((a, b) => a.startTick - b.startTick);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].startTick < arr[i - 1].endTick) {
        violations.push(`Overlap in parent ${k}: ${arr[i - 1].key}[${arr[i - 1].startTick},${arr[i - 1].endTick}) overlaps ${arr[i].key}[${arr[i].startTick},${arr[i].endTick})`);
      }
    }
  }
  expect(violations.length).toBe(0);
});
