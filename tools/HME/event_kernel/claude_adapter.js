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
const timeTravel = require('./lifecycle_time_travel');

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

function logHookError(root, event, message, kind = 'hook-runtime-error') {
  try {
    const base = root || requireEnv('PROJECT_ROOT');
    if (!base || !message) return;
    const ts = new Date().toISOString();
    const clean = String(message || '').replace(/\s*\r?\n\s*/g, ' ');
    const tail = JSON.stringify({ event: kind, message: clean, hook_event: event });
    const errLog = path.join(base, 'log', 'hme-errors.log');
    const hmeLog = path.join(base, 'log', 'hme.log');
    fs.mkdirSync(path.dirname(errLog), { recursive: true });
    fs.appendFileSync(errLog, `[${ts}] [${kind}] ${clean}  ${tail}\n`);
    fs.appendFileSync(hmeLog, `${ts.replace('T', ' ').replace('Z', '')} ERROR ${kind}: ${clean}  ${tail}\n`);
  } catch (_e) { /* best-effort lifesaver log */ }
}

function shouldLogHookStderr(stderr) {
  const text = String(stderr || '').trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.every((line) => /^ok$/i.test(line))) return false;
  if (/^Stop hook error:/i.test(text)) return false;
  return /\b(error|failed|failure|exception|traceback|invalid|crash|denied|JSON validation failed)\b/i.test(text);
}

function _lifesaverBlock(event, message) {
  const alert = `[ALERT] LIFESAVER: ${message}`;
  if (event === 'PreToolUse' || event === 'PermissionRequest') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: 'deny',
        permissionDecisionReason: alert,
      },
    });
  }
  const out = { decision: 'block', reason: alert };
  if (event === 'UserPromptSubmit') {
    out.hookSpecificOutput = { hookEventName: event, additionalContext: alert };
  }
  return JSON.stringify(out);
}

function _normalizeClaudeStdoutObject(event, parsed) {
  const issues = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { parsed: null, issues: ['stdout JSON root must be an object'] };
  }
  const out = { ...parsed };
  if (out.hookSpecificOutput && typeof out.hookSpecificOutput === 'object' && !Array.isArray(out.hookSpecificOutput)) {
    out.hookSpecificOutput = { ...out.hookSpecificOutput };
    if (!out.hookSpecificOutput.hookEventName) {
      out.hookSpecificOutput.hookEventName = event;
    } else if (out.hookSpecificOutput.hookEventName !== event) {
      issues.push(`hookSpecificOutput hookEventName=${JSON.stringify(out.hookSpecificOutput.hookEventName)} did not match ${event}; corrected before host relay`);
      out.hookSpecificOutput.hookEventName = event;
    }
  }

  if (event === 'UserPromptSubmit') {
    if (out.decision === 'allow') {
      delete out.decision;
      if (Object.prototype.hasOwnProperty.call(out, 'reason')) delete out.reason;
      issues.push('UserPromptSubmit root decision="allow" is not valid Claude hook JSON; stripped allow diagnostic fields');
    } else if (out.decision && out.decision !== 'block') {
      issues.push(`UserPromptSubmit root decision=${JSON.stringify(out.decision)} is not valid Claude hook JSON; stripped decision fields`);
      delete out.decision;
      if (Object.prototype.hasOwnProperty.call(out, 'reason')) delete out.reason;
    } else if (!out.decision && Object.prototype.hasOwnProperty.call(out, 'reason')) {
      issues.push('UserPromptSubmit root reason without decision="block" is not valid Claude hook JSON; stripped reason');
      delete out.reason;
    }
    const hso = out.hookSpecificOutput;
    if (hso && typeof hso === 'object' && !Array.isArray(hso) && hso.permissionDecision) {
      if (hso.permissionDecisionReason && !hso.additionalContext) hso.additionalContext = hso.permissionDecisionReason;
      delete hso.permissionDecision;
      delete hso.permissionDecisionReason;
      issues.push('UserPromptSubmit hookSpecificOutput contained PreToolUse permissionDecision fields; stripped before host relay');
    }
  }
  return { parsed: out, issues };
}

function validateClaudeStdout(event, stdout, root) {
  const text = String(stdout || '').trim();
  if (!text) return stdout || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = `JSON validation failed for Claude ${event} hook stdout: ${err.message}`;
    logHookError(root, event, message, 'hook-output-validation');
    return _lifesaverBlock(event, message);
  }
  const normalized = _normalizeClaudeStdoutObject(event, parsed);
  if (!normalized.parsed) {
    const message = `Hook JSON output validation failed for Claude ${event}: ${normalized.issues.join('; ')}`;
    logHookError(root, event, message, 'hook-output-validation');
    return _lifesaverBlock(event, message);
  }
  if (normalized.issues.length) {
    const message = `Hook JSON output validation failed for Claude ${event}: ${normalized.issues.join('; ')}`;
    logHookError(root, event, message, 'hook-output-validation');
    return JSON.stringify(normalized.parsed);
  }
  return stdout;
}

function finalRelay(event, result, body = '{}') {
  const fields = claudeRelayFields(event, result);
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch (_err) { payload = {}; }
  const root = payload._hme_project_root || requireEnv('PROJECT_ROOT');
  const thread_id = timeTravel.threadId({ host: 'claude', event, payload });
  timeTravel.checkpoint({ root, host: 'claude', event, payload, phase: 'relay:raw', values: { thread_id, raw_stdout: result.stdout || '', relay_stdout: fields.stdout || '', relay_stderr: fields.stderr || '', exit_code: fields.exit_code } });
  fields.stdout = validateClaudeStdout(event, fields.stdout, root);
  timeTravel.checkpoint({ root, host: 'claude', event, payload, phase: 'relay:validated', values: { thread_id, relay_stdout: fields.stdout || '', relay_stderr: fields.stderr || '', exit_code: fields.exit_code } });
  if (shouldLogHookStderr(fields.stderr)) logHookError(root, event, fields.stderr.trim());
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

module.exports = { finalRelay, proxyDownBanner, validateClaudeStdout, shouldLogHookStderr };
