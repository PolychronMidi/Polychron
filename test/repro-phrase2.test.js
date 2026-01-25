import { it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

it('Reproducer: targeted run reproduces no overlaps for phrase2 beat1/5 (or captures overlaps)', () => {
  const script = path.join('scripts', 'repro', 'repro-phrase2.js');
  const res = spawnSync(process.execPath, [script], { env: { ...process.env, PLAY_LIMIT: '1', INDEX_TRACES: '1' }, stdio: 'inherit' });
  // res.status === 0 means no overlaps (success)
  expect(res.status, 'Expected reproducer to exit 0 (no overlaps). If non-zero, see output/repro-overlaps.ndjson').toBe(0);
}, 60000);
