import { it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

it('flapping getSubsubdivs reproducer should produce no subsubdivision anomalies', () => {
  const script = path.join(process.cwd(), 'scripts', 'run-getSubsubFlip.js');
  const res = spawnSync(process.execPath, [script], { env: { ...process.env, INDEX_TRACES: '1', INDEX_TRACES_ASSERT: '1', PLAY_LIMIT: '1', SUPPRESS_HUMAN_MARKER_CHECK: '1' }, stdio: 'inherit' });
  expect(res.status === 0, `Expected script to exit 0, got ${res.status}`).toBe(true);
}, 120000);
