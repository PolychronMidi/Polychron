import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

it('subsubdiv units are within their subdiv parent bounds', () => {
  const outDir = path.join(process.cwd(), 'output');

  // Run a fast play in a child process to avoid polluting this process with play.js globals
  process.env.PLAY_LIMIT = '1';
  execSync(process.execPath + ' scripts/play-guard.js', { env: Object.assign({}, process.env, { PLAY_LIMIT: '1' }), stdio: 'inherit' });
  // Build a canonical unit index from output CSVs and master map for inspection
  execSync(process.execPath + ' scripts/exportUnitTreeJson.js', { stdio: 'ignore' });
  const ut = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'unitTreeMap.json'), 'utf8'));
  const units = ut.units || [];
  // Group units by layer and their detailed parts
  const byLayer = {};
  units.forEach(u => { const layer = u.layer || 'primary'; byLayer[layer] = byLayer[layer] || []; byLayer[layer].push(u); });
  for (const layerName of Object.keys(byLayer)) {
    const layerUnits = byLayer[layerName];
    // Build an index of subdiv parents keyed by section/phrase/measure/beat/div/subdiv
    const subdivIndex = {};
    for (const u of units) {
      if (u.unitType === 'subdiv') {
        const key = `${u.sectionIndex}|${u.phraseIndex}|${u.measureIndex}|${u.beatIndex}|${u.divIndex}|${u.subdivIndex}`;
        subdivIndex[key] = u;
      }
    }

    const violations = [];
    for (const u of units) {
      if (u.unitType === 'subsubdiv') {
        const pkey = `${u.sectionIndex}|${u.phraseIndex}|${u.measureIndex}|${u.beatIndex}|${u.divIndex}|${u.subdivIndex}`;
        const parent = subdivIndex[pkey];
        if (!parent) {
          violations.push(`Missing parent subdiv for subsub unit ${u.key || ''}`);
          continue;
        }
        if (!Number.isFinite(u.startTick) || !Number.isFinite(u.endTick)) {
          violations.push(`Non-finite ticks for ${u.key || ''}`);
        }
        if (u.startTick < parent.startTick) violations.push(`startTick < parent.startTick for ${u.key || ''} (${u.startTick} < ${parent.startTick})`);
        if (u.endTick > parent.endTick) violations.push(`endTick > parent.endTick for ${u.key || ''} (${u.endTick} > ${parent.endTick})`);
        if (u.endTick <= u.startTick) violations.push(`endTick <= startTick for ${u.key || ''} (${u.startTick} >= ${u.endTick})`);
      }
    }

    expect(violations.length).toBe(0);
  }
});
