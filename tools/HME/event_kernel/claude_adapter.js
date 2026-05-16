#!/usr/bin/env node
'use strict';
/** Claude Code adapter: host-specific envelope/rendering over shared kernel plumbing. */

const fs = require('fs');
const path = require('path');
const { runHostAdapter, append } = require('./host_adapter_common');
const { buildHostPayload, writeJsonAtomic } = require('./lifecycle_payload');
const { claudeRelayFields } = require('./decision_normalizer');
const { recordHookDecision } = require('./hook_decision_log');

function proxyDownBanner(port) {
  return `[ALERT] LIFESAVER - HME PROXY OFFLINE - LOCAL EVENT KERNEL ACTIVE

The HME proxy on 127.0.0.1:${port} is not responding. Claude hook events are
running through the local event kernel fallback. Proxy-only request middleware is
offline until the proxy restarts.

Restart: node tools/HME/proxy/hme_proxy.js
Check:   curl -sf http://127.0.0.1:${port}/health`;
}

function finalRelay(event, result, body = '{}') {
  const fields = claudeRelayFields(event, result);
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  recordHookDecision(payload._hme_project_root || process.env.PROJECT_ROOT, 'claude', event, result.stdout || '', fields.stdout || '', payload);
  if (fields.exit_code === 2 && fields.stderr) process.stderr.write(`${fields.stderr}\n`);
  process.stdout.write(JSON.stringify(fields));
  process.exit(fields.exit_code);
}

async function main() {
  const event = process.argv[2] || 'unknown';
  await runHostAdapter({
    host: 'claude',
    event,
    rootEnvKeys: ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR'],
    maintenanceStderr: ' ',
    buildBody: ({ root, rawBody, cwd }) => buildHostPayload({ host: 'claude', event, root, rawBody, cwd, teamRole: process.env.HME_TEAM_ROLE }),
    onDirectFallback: ({ result, root, port, event: ev, ts }) => {
      writeJsonAtomic(path.join(root, 'tmp', 'hme-proxy-down.flag'), `[${ts}] [claude-adapter] proxy unreachable; ${ev} ran in direct mode\n`);
      if (ev === 'SessionStart' || ev === 'UserPromptSubmit') {
        const banner = proxyDownBanner(port);
        result.stdout = result.stdout || JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: banner }, systemMessage: banner });
      }
      return result;
    },
    onProxyResult: ({ root, port, ts, event: ev }) => {
      const flag = path.join(root, 'tmp', 'hme-proxy-down.flag');
      if (!fs.existsSync(flag)) return;
      try { fs.unlinkSync(flag); } catch (_err) { /* best effort */ }
      append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [claude-adapter] proxy recovered on 127.0.0.1:${port} (event=${ev})`);
    },
    finalRelay,
  });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[claude_adapter] crash: ${err.stack || err.message}\n`);
    process.exit(0);
  });
}

module.exports = { finalRelay, proxyDownBanner };
