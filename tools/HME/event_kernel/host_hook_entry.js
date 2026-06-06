#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { renderDeny } = require('./decision_renderer');

const MAX_STDIN_BYTES = 1024 * 1024;
const ADAPTER_TIMEOUT_MS = 150_000;
const PEER_BYPASS_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact', 'PostCompact']);
const GATING_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

function arg(name, argv = process.argv) {
  const idx = argv.indexOf(`--${name}`);
  return idx >= 0 ? argv[idx + 1] : '';
}

function eventFromArg(argv = process.argv) {
  return arg('event', argv) || argv[2] || '';
}

function adapterForHost(host, root = path.resolve(__dirname, '..')) {
  return host === 'codex'
    ? path.join(root, 'event_kernel', 'codex_adapter.js')
    : host === 'opencode'
      ? path.join(root, 'event_kernel', 'opencode_adapter.js')
      : host === 'claude'
        ? path.join(root, 'event_kernel', 'claude_adapter.js')
        : '';
}

function shouldBypassPeerLifecycle(event, env = process.env) {
  return env.HME_TEAM_PEER === '1' && PEER_BYPASS_EVENTS.has(event);
}

function failSafeStdout(event, message) {
  return GATING_EVENTS.has(event) ? renderDeny(event, message) : '';
}

function exitFailSafe(event, message, code = 0) {
  const stdout = failSafeStdout(event, message);
  if (stdout) process.stdout.write(stdout);
  if (message) process.stderr.write(`[host_hook_entry] ${message}\n`);
  process.exit(code);
}

function readStdinBounded(event, fd = 0) {
  const chunks = [];
  let total = 0;
  const buf = Buffer.allocUnsafe(64 * 1024);
  while (true) {
    let n = 0;
    try {
      n = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      // silent-ok: stdin read errors are surfaced immediately as host-hook stderr
      // and a fail-safe gating denial where applicable.
      exitFailSafe(event, `stdin read failed: ${err.message}`, GATING_EVENTS.has(event) ? 0 : 1);
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_STDIN_BYTES) {
      exitFailSafe(event, `stdin exceeded ${MAX_STDIN_BYTES} bytes`);
    }
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

function main() {
  const host = arg('host');
  const event = eventFromArg();
  const root = path.resolve(__dirname, '..');
  const stdin = readStdinBounded(event);

  // Ephemeral team-peer sub-sessions (ask-peer.sh sets HME_TEAM_PEER=1) must NOT
  // run the driver's orchestration lifecycle. Tool/permission events still flow
  if (shouldBypassPeerLifecycle(event)) process.exit(0);

  const adapter = adapterForHost(host, root);
  if (!adapter) {
    console.error(`host_hook_entry: unsupported host ${JSON.stringify(host)}`);
    process.exit(1);
  }

  const child = spawnSync(process.execPath, [adapter, event], {
    input: stdin,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
    timeout: ADAPTER_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });

  if (child.error) {
    const timedOut = child.error.code === 'ETIMEDOUT';
    exitFailSafe(event, `adapter ${timedOut ? 'timed out' : 'failed'} for ${event}: ${child.error.message}`);
  }
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  process.exit(child.status == null ? 1 : child.status);
}

if (require.main === module) main();

module.exports = {
  MAX_STDIN_BYTES,
  ADAPTER_TIMEOUT_MS,
  PEER_BYPASS_EVENTS,
  GATING_EVENTS,
  arg,
  eventFromArg,
  adapterForHost,
  shouldBypassPeerLifecycle,
  failSafeStdout,
};
