import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

// This is a gated regression test for a previously triaged parent that produced overlaps.
// It is intentionally skipped unless RUN_REPRO_TEST=1 is set in the environment so
// it can be enabled in CI only when you want to assert regressions are resolved.

const RUN = process.env.RUN_REPRO_TEST;
const TARGET_PARENT = process.env.TARGET_PARENT || 'primary|section1/1|phrase4/4|measure1/1|beat3/4';

describe('overlap regression (gated)', () => {
  if (!RUN) {
    it.skip('skipped: set RUN_REPRO_TEST=1 to enable', () => {});
    return;
  }

  it('repro-parent should find no overlaps for the triaged parent', () => {
    const safe = TARGET_PARENT.replace(/[^a-zA-Z0-9-_]/g, '_');
    // Run repro-parent with diagnostic flags so any overlap produces a verbose trace
    const res = spawnSync(process.execPath, [path.join('scripts','repro','repro-parent.js'), 'env:' + TARGET_PARENT, '48'], { env: { ...process.env, PLAY_LIMIT: '48', INDEX_TRACES: '1', ENABLE_OVERLAP_DETECT: '1' }, encoding: 'utf8', stdio: 'pipe' });

    const outFile = path.join(process.cwd(), 'output', `repro-parent-${safe}.json`);
    if (!fs.existsSync(outFile)) {
      console.error('repro-parent did not create output file; stdout/stderr:', res.stdout, res.stderr);
      throw new Error('repro-parent did not produce output');
    }

    const obj = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    // On failure, include verbose overlap trace (if present) for triage
    const verbosePath = path.join(process.cwd(), 'output', 'detected-overlap-verbose.ndjson');
    if (obj.overlapCount && fs.existsSync(verbosePath)) {
      console.error('VERBOSE OVERLAP TRACE FOUND:', fs.readFileSync(verbosePath, 'utf8'));
    }

    expect(obj).toBeDefined();
    expect(obj.unitCount).toBeGreaterThan(0);
    expect(obj.overlapCount).toBe(0);
  });
});
