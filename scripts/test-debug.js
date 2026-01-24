#!/usr/bin/env node
// Historically this was a .cjs shim to handle Windows `npm.cmd` spawn behavior; now ESM with explicit platform handling.
import { spawnSync } from 'child_process';

console.log('test:debug - running tests with DEBUG_UNIT_COVERAGE=1');

const env = { ...process.env, DEBUG_UNIT_COVERAGE: '1' };
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const res = spawnSync(npmCmd, ['run', 'test'], { stdio: 'inherit', env });
if (res.error) {
  console.error('test:debug failed to start tests', res.error);
  process.exit(1);
}
process.exit(res.status || 0);
