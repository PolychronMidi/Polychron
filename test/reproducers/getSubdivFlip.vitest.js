import { it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

it('flapping composer reproducer should produce no anomalies (INDEX_TRACES_ASSERT)', () => {
  const script = path.join(process.cwd(), 'scripts', 'run-getSubdivFlip.js');
  const res = spawnSync(process.execPath, [script], { env: { ...process.env, INDEX_TRACES: '1', INDEX_TRACES_ASSERT: '1', PLAY_LIMIT: '1' }, stdio: 'inherit' });
  // Expect exit status 0 (no fatal anomalies)
  expect(res.status === 0, `Expected script to exit 0, got ${res.status}`).toBe(true);
});
