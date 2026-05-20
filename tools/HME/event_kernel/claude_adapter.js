#!/usr/bin/env node
'use strict';
/** Claude Code adapter: host-specific envelope/rendering over shared kernel plumbing. */

const fs = require('fs');
const path = require('path');
const { requireEnv } = require('../proxy/shared/load_env');
const { runHostAdapter, append } = require('./host_adapter_common');
const { buildHostPayload, writeJsonAtomic } = require('./lifecycle_payload');
const { claudeRelayFields } = require('./decision_normalizer');
const { recordHookDecision } = require('./hook_decision_log');

function denyReason(stdout) {
  try {
    const obj = JSON.parse(stdout || '{}');
    return obj && obj.decision === 'block' && typeof obj.reason === 'string' ? obj.reason : '';
  } catch (_err) { return ''; }
}

function stageStopReminder(root, reason) {
  if (!root || !reason) return;
  const file = path.join(root, 'tmp', 'hme-stop-reminder.json');
  const text = reason.replace(/^\s*Stop hook feedback:\s*/i, '').trim();
  writeJsonAtomic(file, JSON.stringify({ ts: new Date().toISOString(), text }));
}

function proxyDownBanner(port) {
  return `[ALERT] LIFESAVER - HME PROXY OFFLINE - LOCAL EVENT KERNEL ACTIVE

The HME proxy on 127.0.0.1:${port} is not responding. Claude hook events are
running through the local event kernel fallback. Proxy-only request middleware is
offline until the proxy restarts.

Restart: node tools/HME/proxy/hme_proxy.js
Check:   curl -sf http://127.0.0.1:${port}/health`;
}

function validateClaudeStdout(event, stdout, root) {
  const text = String(stdout || '').trim();
  if (!text) return stdout || '';
  try {
    JSON.parse(text);
    return stdout;
  } catch (err) {
    const message = `JSON validation failed for Claude ${event} hook stdout: ${err.message}`;
    try {
      const base = root || requireEnv('PROJECT_ROOT');
      if (!base) return JSON.stringify({ decision: 'block', reason: `[ALERT] LIFESAVER: ${message}` });
      const log = path.join(base, 'log', 'hme-errors.log');
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.appendFileSync(log, `[${new Date().toISOString()}] [hook-output-validation] ${message}\n`);
    } catch (_e) { /* best-effort lifesaver log */ }
    return JSON.stringify({ decision: 'block', reason: `[ALERT] LIFESAVER: ${message}` });
  }
}

function finalRelay(event, result, body = '{}') {
  const fields = claudeRelayFields(event, result);
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  const root = payload._hme_project_root || requireEnv('PROJECT_ROOT');
  fields.stdout = validateClaudeStdout(event, fields.stdout, root);
  recordHookDecision(root, 'claude', event, result.stdout || '', fields.stdout || '', payload);
  if (fields.stdout) process.stdout.write(fields.stdout);
  if (fields.stderr && fields.stderr.trim()) process.stderr.write(fields.stderr.endsWith('\n') ? fields.stderr : `${fields.stderr}\n`);
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
    beforeFinalRelay: ({ event: ev, result, root }) => {
      if (ev !== 'Stop') return result;
      const reason = denyReason(result.stdout || '');
      if (reason) stageStopReminder(root, reason);
      return result;
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

module.exports = { finalRelay, proxyDownBanner, validateClaudeStdout };
