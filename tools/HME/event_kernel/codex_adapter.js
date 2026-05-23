#!/usr/bin/env node
'use strict';
/** Codex CLI adapter: Codex wire rendering over shared event-kernel plumbing. */

const path = require('path');
const { runHostAdapter, append } = require('./host_adapter_common');
const { buildHostPayload } = require('./lifecycle_payload');
const decisions = require('./decision_normalizer');
const decisionLog = require('./hook_decision_log');
const timeTravel = require('./lifecycle_time_travel');

function sanitizeStdout(event, stdout) { return decisions.sanitizeCodexStdout(event, stdout); }
function sanitizeHookSpecific(event, out) { return decisions.sanitizeHookSpecific(event, out); }
function toPermissionRequestOutput(parsed) { return decisions.toPermissionRequestOutput(parsed); }
function hookDecisionSummary(event, rawStdout, sanitizedStdout, payload = {}) {
  return decisionLog.hookDecisionSummary('codex', event, rawStdout, sanitizedStdout, payload);
}
function recordHookDecision(root, event, rawStdout, sanitizedStdout, payload = {}) {
  return decisionLog.recordHookDecision(root, 'codex', event, rawStdout, sanitizedStdout, payload);
}

function finalRelay(event, result, body = '{}') {
  const rawStdout = result.stdout || '';
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  const root = payload._hme_project_root || process.env.PROJECT_ROOT;
  const thread_id = timeTravel.threadId({ host: 'codex', event, payload });
  timeTravel.checkpoint({ root, host: 'codex', event, payload, phase: 'relay:raw', values: { thread_id, raw_stdout: rawStdout, raw_stderr: result.stderr || '', exit_code: result.exit_code } });
  const stdout = normalizeCodexHookStdout(event, sanitizeStdout(event, rawStdout));
  timeTravel.checkpoint({ root, host: 'codex', event, payload, phase: 'relay:validated', values: { thread_id, relay_stdout: stdout, relay_stderr: result.stderr || '', exit_code: result.exit_code } });
  recordHookDecision(root, event, rawStdout, stdout, payload);
  const stderr = result.stderr && result.stderr.trim() ? result.stderr : '';
  const code = Number.isInteger(result.exit_code) ? result.exit_code : 0;
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  process.exit(code);
}


function firstJsonDocument(text) {
  const src = String(text || '');
  const start = src.search(/[\[{]/);
  if (start < 0) return null;
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch !== '}' && ch !== ']') continue;
    const open = stack.pop();
    if ((open !== '{' || ch !== '}') && (open !== '[' || ch !== ']')) return null;
    if (stack.length === 0) {
      try { return JSON.parse(src.slice(start, i + 1)); }
      catch (_) { return null; }
    }
  }
  return null;
}

function normalizeCodexHookStdout(event, stdout) {
  if (event !== 'UserPromptSubmit') return stdout;
  const parsed = firstJsonDocument(stdout);
  const doc = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  return `${JSON.stringify(doc)}\n`;
}

async function main() {
  const event = process.argv[2] || 'unknown';
  await runHostAdapter({
    host: 'codex',
    event,
    rootEnvKeys: ['PROJECT_ROOT', 'CODEX_PROJECT_ROOT'],
    hostProjectEnv: 'CODEX_PROJECT_ROOT',
    maintenanceStderr: '',
    buildBody: ({ root, rawBody, cwd }) => buildHostPayload({ host: 'codex', event, root, rawBody, cwd, teamRole: process.env.HME_TEAM_ROLE }),
    onProxyResult: ({ root, ts, event: ev }) => append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [codex-adapter] ${ev} proxied`),
    finalRelay,
  });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[codex_adapter] crash: ${err.stack || err.message}\n`);
    process.exit(0);
  });
}

module.exports = { sanitizeStdout, sanitizeHookSpecific, toPermissionRequestOutput, hookDecisionSummary, recordHookDecision, finalRelay };
