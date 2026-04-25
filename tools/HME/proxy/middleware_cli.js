#!/usr/bin/env node
'use strict';
/**
 * Universal middleware runner CLI. Any caller can apply the proxy's
 * middleware pipeline to a tool-result event without needing the
 * long-running proxy daemon.
 *
 * Architectural intent (mirrors hook_bridge / stop_chain): make the
 * pipeline a callable utility, not a proxy-internal coupling. Other
 * components (direct_dispatch, test harnesses, sanitization helpers,
 * future agent-side tools) can shell out to this CLI to get the same
 * mutation semantics middleware/index.js applies on the request path.
 *
 * Usage:
 *   echo '{"toolUse":{...},"toolResult":{...}}' \
 *     | node middleware_cli.js onToolResult [--filter=name1,name2]
 *
 *   node middleware_cli.js list
 *     # prints registered middleware names, one per line
 *
 *   echo 'sk-proj-AbCdEfGh1234567890ZyXwVuTsRq' \
 *     | node middleware_cli.js sanitize
 *     # convenience mode: scrub-only, takes raw text on stdin, writes
 *     # scrubbed text to stdout. Equivalent to onToolResult with
 *     # filter=secret_sanitizer + a synthetic toolUse/toolResult shape.
 *
 * Input shape for onToolResult: {toolUse: {name, input, id}, toolResult: {content, tool_use_id}}
 * Output shape: same JSON, with content possibly mutated by registered middleware.
 *
 * Process boundary: stdin capped at 4MB, exit 0 on chain crash (callers
 * decide how to handle a missing pipeline output — never wedge them).
 */

const middleware = require('./middleware');

const MAX_STDIN = 4 * 1024 * 1024;

function usage() {
  process.stderr.write([
    'Usage:',
    '  middleware_cli.js onToolResult [--filter=name1,name2] < {toolUse,toolResult}.json',
    '  middleware_cli.js sanitize < raw-text   # secret_sanitizer only, text-in/text-out',
    '  middleware_cli.js list',
    '',
  ].join('\n'));
}

async function readStdin(maxBytes) {
  let buf = '';
  for await (const chunk of process.stdin) {
    buf += chunk;
    if (buf.length > maxBytes) {
      process.stderr.write(`[middleware_cli] stdin >${maxBytes}B; aborting\n`);
      process.exit(0);
    }
  }
  return buf;
}

async function main() {
  const args = process.argv.slice(2);
  const phase = args[0] || '';
  const filterArg = args.find((a) => a.startsWith('--filter='));
  const filter = filterArg
    ? new Set(filterArg.split('=')[1].split(',').filter(Boolean))
    : null;

  middleware.loadAll();

  if (phase === 'list') {
    for (const m of middleware._modules) process.stdout.write(`${m.name}\n`);
    process.exit(0);
  }

  if (phase === 'sanitize') {
    // Convenience: text-in/text-out wrapper around secret_sanitizer.
    // Synthesizes a fake Bash tool_result so the filter contract holds.
    const text = await readStdin(MAX_STDIN);
    const toolUse = { name: 'Bash', input: {}, id: 'cli-sanitize' };
    const toolResult = { content: text, tool_use_id: 'cli-sanitize' };
    await middleware.runOnToolResult(toolUse, toolResult, {
      filter: new Set(['secret_sanitizer']),
    });
    process.stdout.write(typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content));
    process.exit(0);
  }

  if (phase !== 'onToolResult') {
    usage();
    process.exit(2);
  }

  const stdin = await readStdin(MAX_STDIN);
  let input;
  try { input = JSON.parse(stdin || '{}'); }
  catch (err) {
    process.stderr.write(`[middleware_cli] invalid stdin JSON: ${err.message}\n`);
    process.exit(2);
  }
  const { toolUse, toolResult } = input;
  if (!toolUse || !toolResult) {
    process.stderr.write('[middleware_cli] expected {toolUse, toolResult}\n');
    process.exit(2);
  }
  const dirty = await middleware.runOnToolResult(toolUse, toolResult, { filter });
  process.stdout.write(JSON.stringify({ toolUse, toolResult, dirty }));
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[middleware_cli] crash: ${err.stack || err.message}\n`);
  process.exit(1);
});
