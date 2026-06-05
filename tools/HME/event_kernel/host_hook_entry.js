#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const host = arg('host');
const event = arg('event') || process.argv[2] || '';
const root = path.resolve(__dirname, '..');

// Ephemeral team-peer sub-sessions (ask-peer.sh sets HME_TEAM_PEER=1) must NOT
// run the driver's orchestration lifecycle. A `-p` peer fires UserPromptSubmit
if (process.env.HME_TEAM_PEER === '1') {
  try { require('fs').readFileSync(0); } catch (_e) { /* no stdin: fine */ }
  process.exit(0);
}

const adapter = host === 'codex'
  ? path.join(root, 'event_kernel', 'codex_adapter.js')
  : host === 'opencode'
    ? path.join(root, 'event_kernel', 'opencode_adapter.js')
    : host === 'claude'
      ? path.join(root, 'event_kernel', 'claude_adapter.js')
      : '';

if (!adapter) {
  console.error(`host_hook_entry: unsupported host ${JSON.stringify(host)}`);
  process.exit(1);
}

const child = spawnSync(process.execPath, [adapter, event], {
  input: require('fs').readFileSync(0),
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
process.exit(child.status == null ? 1 : child.status);
