#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const DISPATCH = path.join(PROJECT_ROOT, 'tools', 'HME', 'event_kernel', 'cli.js');

const CASES = [
  { name: 'PreToolUse Read', event: 'PreToolUse', payload: { tool_name: 'Read', tool_input: { file_path: path.join(PROJECT_ROOT, 'doc', 'templates', 'AGENTS.md') }, session_id: 'direct-test' } },
  { name: 'PostToolUse Bash', event: 'PostToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'true' }, tool_response: { exit_code: 0, stdout: '', stderr: '' }, session_id: 'direct-test' } },
];

function runCase(testCase) {
  const res = spawnSync('node', [DISPATCH, testCase.event], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT, CLAUDE_PROJECT_DIR: PROJECT_ROOT, HME_HOOK_DIRECT_TEST: '1' },
    input: JSON.stringify(testCase.payload),
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { ...testCase, code: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function main() {
  if (!fs.existsSync(DISPATCH)) throw new Error(`missing ${DISPATCH}`);
  const results = CASES.map(runCase);
  let failed = 0;
  for (const r of results) {
    const ok = r.code === 0 || r.code === 2;
    const expectedBlock = r.code === 1 && /Raw tool streak/.test(r.stderr || r.stdout);
    if (!ok && !expectedBlock) failed += 1;
    console.log(`${ok || expectedBlock ? 'ok' : 'not ok'} - ${r.name} (${r.event}) code=${r.code}${expectedBlock ? ' expected-block' : ''}`);
    if (!ok && !expectedBlock) console.log((r.stderr || r.stdout).slice(0, 1000));
  }
  if (failed) process.exit(1);
}

if (require.main === module) main();

module.exports = { CASES, runCase };
