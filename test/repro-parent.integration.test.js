import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const TARGET = process.env.TARGET_PARENT;
const RUN = process.env.RUN_REPRO_TEST;

describe('repro parent integration (gated)', () => {
  if (!RUN) {
    it.skip('skipped: set RUN_REPRO_TEST=1 to enable', () => {});
    return;
  }

  it('reproduces target parent and has no overlaps', () => {
    if (!TARGET) throw new Error('Please set TARGET_PARENT env var to the parent key you want to test');
    // Run repro-parent with PLAY_LIMIT default or 48
    const res = spawnSync(process.execPath, [path.join('scripts','repro','repro-parent.js'), 'env:' + TARGET, '48'], { env: { ...process.env, PLAY_LIMIT: '48', INDEX_TRACES: '1' }, encoding: 'utf8', stdio: 'pipe' });
    const safe = TARGET.replace(/[^a-zA-Z0-9-_]/g, '_');
    const outFile = path.join(process.cwd(), 'output', `repro-parent-${safe}.json`);
    let obj = null;
    if (fs.existsSync(outFile)) obj = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    // If child process failed, include stdout/stderr to help debug
    if (res.status && (!obj || obj.overlapCount > 0)) {
      console.error('repro-child stdout:', res.stdout);
      console.error('repro-child stderr:', res.stderr);
    }
    expect(obj).toBeDefined();
    expect(obj.unitCount).toBeGreaterThan(0);
    expect(obj.overlapCount).toBe(0);
  });
});
