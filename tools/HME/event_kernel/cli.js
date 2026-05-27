#!/usr/bin/env node
'use strict';
/**
 * Agent-CLI adapter for the HME event kernel.
 *
 * Reads a hook/lifecycle payload on stdin, dispatches through the canonical
 * event kernel, then translates the result to the simple stdout/stderr/exit
 * convention expected by shell hook forwarders.
 */

const { dispatchEvent } = require('./dispatcher');

const MAX_STDIN_BYTES = 1024 * 1024;

function _denyReason(stdout) {
  if (!stdout) return '';
  try {
    const parsed = JSON.parse(stdout);
    return (
      parsed.reason
      || parsed.message
      || (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecisionReason)
      || ''
    );
  } catch (_e) {
    // silent-ok: optional fallback path.
    return '';
  }
}

async function main() {
  const eventName = process.argv[2] || 'unknown';
  let stdin = '';
  for await (const chunk of process.stdin) {
    stdin += chunk;
    if (stdin.length > MAX_STDIN_BYTES) {
      process.stderr.write(`[event_kernel/cli] stdin exceeded ${MAX_STDIN_BYTES} bytes; aborting event=${eventName}\n`);
      process.exit(0);
    }
  }

  const result = await dispatchEvent(eventName, stdin || '{}');
  let exitCode = Number.isInteger(result.exit_code) ? result.exit_code : 0;
  let stderr = result.stderr || '';

  // Claude Code's hook protocol is most reliable when a deny is also carried
  if ((eventName === 'PreToolUse' || eventName === 'Stop') && exitCode === 0) {
    const reason = _denyReason(result.stdout || '');
    if (reason) {
      exitCode = 2;
      stderr = stderr && stderr.trim() ? `${stderr}\n${reason}` : reason;
    }
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (stderr && stderr !== ' ') process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`[event_kernel/cli] crash: ${err.stack || err.message}\n`);
  process.exit(0);
});
