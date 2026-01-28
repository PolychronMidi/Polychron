import { it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

it('unitMasterMap denominators are consistent within parent units', () => {
  // Run a short deterministic play to generate unitMasterMap
  const env = { ...process.env, PLAY_LIMIT: '1' };
  const res = spawnSync(process.execPath, [path.join('src','play.js')], { env, stdio: 'inherit' });
  if (res.error) throw res.error;

  const fmap = path.join(process.cwd(), 'output', 'unitMasterMap.json');
  expect(fs.existsSync(fmap), 'Expected unitMasterMap.json produced').toBe(true);
  const raw = fs.readFileSync(fmap, 'utf8');
  const items = JSON.parse(raw);

  // group by parent up to beat-level: primary|sectionX|phraseY|measureZ|beatA/B
  const groups = {};
  for (const it of items) {
    const parts = it.key.split('|');
    if (parts.length < 5) continue;
    const parent = parts.slice(0,5).join('|');
    // subdiv part may be parts[5]
    const subdivPart = parts[5];
    if (!subdivPart) continue;
    const match = String(subdivPart).match(/subdiv\d+\/(\d+)/);
    if (!match) continue;
    const denom = Number(match[1]);
    groups[parent] = groups[parent] || new Set();
    groups[parent].add(denom);
  }

  const bad = Object.entries(groups).filter(([k,s]) => s.size > 1);
  expect(bad.length, `Expected no parents with multiple subdiv denominators. Examples: ${JSON.stringify(bad.slice(0,4))}`).toBe(0);
});
