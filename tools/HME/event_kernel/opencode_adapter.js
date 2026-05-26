#!/usr/bin/env node
'use strict';

const path = require('path');
const { runHostAdapter, append } = require('./host_adapter_common');
const { buildHostPayload } = require('./lifecycle_payload');
const decisions = require('./decision_normalizer');
const decisionLog = require('./hook_decision_log');
const timeTravel = require('./lifecycle_time_travel');

function sanitizeStdout(_event, stdout) {
  return decisions.sanitizeCodexStdout(_event, stdout);
}

function recordHookDecision(root, event, rawStdout, sanitizedStdout, payload = {}) {
  return decisionLog.recordHookDecision(root, 'opencode', event, rawStdout, sanitizedStdout, payload);
}

function finalRelay(event, result, body = '{}') {
  const rawStdout = result.stdout || '';
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  const root = payload._hme_project_root || process.env.PROJECT_ROOT;
  const thread_id = timeTravel.threadId({ host: 'opencode', event, payload });
  timeTravel.checkpoint({ root, host: 'opencode', event, payload, phase: 'relay:raw', values: { thread_id, raw_stdout: rawStdout, raw_stderr: result.stderr || '', exit_code: result.exit_code } });
  const stdout = sanitizeStdout(event, rawStdout);
  timeTravel.checkpoint({ root, host: 'opencode', event, payload, phase: 'relay:validated', values: { thread_id, relay_stdout: stdout, relay_stderr: result.stderr || '', exit_code: result.exit_code } });
  recordHookDecision(root, event, rawStdout, stdout, payload);
  const stderr = result.stderr && result.stderr.trim() ? result.stderr : '';
  const code = Number.isInteger(result.exit_code) ? result.exit_code : 0;
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  process.exit(code);
}

async function main() {
  const event = process.argv[2] || 'unknown';
  await runHostAdapter({
    host: 'opencode',
    event,
    rootEnvKeys: ['PROJECT_ROOT', 'OPENCODE_PROJECT_ROOT'],
    hostProjectEnv: 'OPENCODE_PROJECT_ROOT',
    maintenanceStderr: '',
    directOnly: true,
    buildBody: ({ root, rawBody, cwd }) => buildHostPayload({ host: 'opencode', event, root, rawBody, cwd, teamRole: process.env.HME_TEAM_ROLE }),
    onProxyResult: ({ root, ts, event: ev }) => append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [opencode-adapter] ${ev} proxied`),
    finalRelay,
  });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[opencode_adapter] crash: ${err.stack || err.message}\n`);
    process.exit(0);
  });
}

module.exports = { sanitizeStdout, recordHookDecision, finalRelay };
