#!/usr/bin/env node
'use strict';
/**
 * Standalone CLI for the Stop hook policy chain. Runs without the proxy
 * daemon — implements the filesystem-IPC architectural lesson: the proxy
 * is an accelerator, not a single point of failure. When the proxy is up,
 * `_proxy_bridge.sh` posts Stop events to it and the proxy invokes
 * `runStopChain` in-process. When the proxy is unreachable, the bridge
 * falls through to this CLI so the chain still fires.
 *
 * Usage:
 *   echo '{"transcript_path":"...","session_id":"..."}' \
 *     | node tools/HME/proxy/stop_chain/cli.js
 *
 * Output shape matches what _proxy_bridge.sh expects to relay back to
 * Claude Code: stdout = decision JSON (or empty), stderr = informational
 * messages, exit_code 0 always (a chain crash should not wedge the agent).
 *
 * What's degraded vs. proxy-mode:
 *   - The dominance_response_rewriter middleware (in proxy/middleware/)
 *     does not run, so block decisions reach Claude Code in their raw
 *     demand-register form rather than as reveal-register cards. This is
 *     acceptable: the gate still fires, the agent still gets the message;
 *     just without the dominance-layer presentation polish.
 *   - secret_sanitizer middleware also does not run. Stop hook payloads
 *     don't typically contain secrets, but if a future policy reads e.g.
 *     transcript content into the deny reason, callers should sanitize.
 *
 * Other lifecycle events (UserPromptSubmit, PreToolUse, etc.) currently
 * still require the proxy. Extending direct-mode to them is a separate
 * pass — Stop is the load-bearing one because losing it lets uncommitted/
 * unreviewed work escape the turn.
 */

const stopChain = require('./index');

async function main() {
  let stdin = '';
  // Bound the stdin read so a stuck pipe can't hang the hook indefinitely.
  // The Claude Code Stop hook payload is small (<10KB typically); 1MB is
  // a generous ceiling matched to FailproofAI's published limit.
  const MAX_STDIN_BYTES = 1024 * 1024;
  for await (const chunk of process.stdin) {
    stdin += chunk;
    if (stdin.length > MAX_STDIN_BYTES) {
      process.stderr.write('[stop_chain/cli] stdin exceeded 1MB; aborting (no decision emitted)\n');
      process.exit(0);
    }
  }
  const result = await stopChain.runStopChain(stdin || '{}');
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exit_code || 0);
}

main().catch((err) => {
  // Chain-level crash. Write the error to stderr so LIFESAVER can pick
  // it up next turn, but exit 0 — never wedge the agent on infra failure.
  process.stderr.write(`[stop_chain/cli] crash: ${err.stack || err.message}\n`);
  process.exit(0);
});
