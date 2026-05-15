#!/usr/bin/env node
'use strict';
/**
 * Codex CLI adapter for the HME event kernel.
 *
 * Codex and Claude expose similar lifecycle hooks but not identical hook
 * output protocols. This adapter keeps host-specific behavior at the edge:
 *   - read Codex hook JSON from stdin
 *   - add small Codex-specific envelope fields
 *   - try proxy /hme/lifecycle
 *   - fall back to the local event kernel
 *   - relay only hook output fields Codex supports
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { dispatchEvent } = require('./dispatcher');
const watchdog = require('./hook_watchdog');
const { nudgeSupervisors } = require('./supervisors');

const LOOP_EVENTS = new Set(['Stop', 'UserPromptSubmit', 'SessionStart', 'PreCompact', 'PostCompact']);
const MAX_STDIN_BYTES = 1024 * 1024;

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.on('data', (chunk) => {
      input += chunk.toString('utf8');
      if (input.length > MAX_STDIN_BYTES) {
        process.stderr.write(`[codex_adapter] stdin exceeded ${MAX_STDIN_BYTES} bytes\n`);
        process.exit(0);
      }
    });
    process.stdin.on('end', () => resolve(input || '{}'));
  });
}

function resolveRoot() {
  const candidates = [process.env.PROJECT_ROOT, process.env.CODEX_PROJECT_ROOT, process.cwd()].filter(Boolean);
  let dir = __dirname;
  while (dir && dir !== path.dirname(dir)) {
    candidates.push(dir);
    dir = path.dirname(dir);
  }
  for (const c of candidates) {
    const root = path.resolve(c);
    if (fs.existsSync(path.join(root, '.git')) && fs.existsSync(path.join(root, 'tools', 'HME'))) return root;
  }
  return path.resolve(__dirname, '..', '..', '..');
}

function parseJson(raw) {
  try { return JSON.parse(raw || '{}'); } catch (_e) { return {}; }
}

function addCodexFields(event, root, body) {
  const payload = parseJson(body);
  payload._hme_host = 'codex';
  payload._hme_event = event;
  if (!payload.cwd) payload.cwd = process.cwd();
  if (!payload.session_id && payload.thread_id) payload.session_id = payload.thread_id;
  if (process.env.HME_TEAM_ROLE) payload._hme_team_role = process.env.HME_TEAM_ROLE;
  if (root) payload._hme_project_root = root;
  return JSON.stringify(payload);
}

function postLifecycle(port, event, body, timeoutMs = 60_000) {
  const payload = Buffer.from(body);
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: `/hme/lifecycle?event=${encodeURIComponent(event)}&host=codex`,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (_e) { resolve({ stdout: '', stderr: 'Non-JSON Proxy Response', exit_code: 1 }); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  });
}

function append(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`);
}

function maintenanceActive(root) {
  const flag = path.join(root, 'tmp', 'hme-proxy-maintenance.flag');
  try {
    const [started, ttlRaw] = fs.readFileSync(flag, 'utf8').split(/\r?\n/);
    const ttl = Number(ttlRaw);
    const start = Date.parse(started);
    return Number.isFinite(ttl) && Number.isFinite(start) && Date.now() - start < ttl * 1000;
  } catch (_e) {
    return false;
  }
}

function unsupportedCodexPreToolDecision(value) {
  return value === 'allow' || value === 'ask' || value === 'approve';
}

function sanitizeHookSpecific(event, out) {
  if (!out || typeof out !== 'object') return out;
  const hso = out.hookSpecificOutput;
  if (!hso || typeof hso !== 'object') return out;
  delete hso.updatedInput;
  delete hso.updatedMCPToolOutput;
  delete hso.suppressOutput;
  delete hso.stopReason;
  if (!hso.hookEventName) hso.hookEventName = event;
  if (event === 'PreToolUse' && hso.permissionDecision === 'deny') {
    if (out.systemMessage === hso.permissionDecisionReason) delete out.systemMessage;
  }
  if ((event === 'PreToolUse' || event === 'PostToolUse') && unsupportedCodexPreToolDecision(hso.permissionDecision)) {
    if (hso.permissionDecisionReason && !hso.additionalContext) hso.additionalContext = hso.permissionDecisionReason;
    delete hso.permissionDecision;
    delete hso.permissionDecisionReason;
  }
  return out;
}

function toPermissionRequestOutput(parsed) {
  const hso = parsed && parsed.hookSpecificOutput;
  if (!hso || typeof hso !== 'object') return sanitizeHookSpecific('PermissionRequest', parsed);
  const reason = hso.permissionDecisionReason || hso.additionalContext || parsed.systemMessage || '';
  if (hso.permissionDecision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: String(reason || 'HME policy denied this request') },
      },
    };
  }
  if (hso.permissionDecision === 'allow') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
      ...(reason ? { systemMessage: String(reason) } : {}),
    };
  }
  if (reason) return { systemMessage: String(reason) };
  return {};
}

function sanitizeStdout(event, stdout) {
  if (!stdout) return '';
  const trimmed = String(stdout).trim();
  if (!trimmed.startsWith('{')) return stdout;
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch (_e) { return stdout; }
  if (event === 'PermissionRequest') {
    const converted = toPermissionRequestOutput(parsed);
    return Object.keys(converted).length ? JSON.stringify(converted) : '';
  }
  if (event === 'PreToolUse' && parsed.decision === 'block' && parsed.reason) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: parsed.reason } });
  }
  const sanitized = sanitizeHookSpecific(event, parsed);
  const emptyHso = sanitized.hookSpecificOutput
    && typeof sanitized.hookSpecificOutput === 'object'
    && Object.keys(sanitized.hookSpecificOutput).length === 1
    && sanitized.hookSpecificOutput.hookEventName;
  if (emptyHso) delete sanitized.hookSpecificOutput;
  return Object.keys(sanitized).length ? JSON.stringify(sanitized) : '';
}


function decisionFields(parsed) {
  const hso = parsed && parsed.hookSpecificOutput;
  if (!hso || typeof hso !== 'object') return { decision: parsed && parsed.decision, reason: parsed && parsed.reason, channels: [] };
  const reason = hso.permissionDecisionReason
    || hso.additionalContext
    || (hso.decision && hso.decision.message)
    || (parsed && parsed.systemMessage)
    || '';
  const decision = hso.permissionDecision || (hso.decision && hso.decision.behavior) || parsed.decision || '';
  const channels = [];
  if (hso.permissionDecisionReason) channels.push('permissionDecisionReason');
  if (hso.additionalContext) channels.push('additionalContext');
  if (hso.decision && hso.decision.message) channels.push('decision.message');
  if (parsed && parsed.systemMessage) channels.push('systemMessage');
  return { decision, reason: String(reason || ''), channels };
}

function reasonHash(reason) {
  if (!reason) return '';
  return crypto.createHash('sha256').update(reason).digest('hex').slice(0, 12);
}

function hookDecisionSummary(event, rawStdout, sanitizedStdout, payload = {}) {
  const raw = parseJson(rawStdout);
  const clean = parseJson(sanitizedStdout);
  const rawFields = decisionFields(raw);
  const cleanFields = decisionFields(clean);
  const reason = cleanFields.reason || rawFields.reason;
  const decision = cleanFields.decision || rawFields.decision;
  if (!reason && !decision) return null;
  return {
    ts: new Date().toISOString(),
    host: 'codex',
    event,
    tool: payload.tool_name || '',
    session_id: payload.session_id || '',
    decision: decision || '',
    reason_hash: reasonHash(reason),
    surfaced_channels: cleanFields.channels,
    raw_channels: rawFields.channels,
    duplicate_systemMessage_stripped: Boolean(
      raw.systemMessage && raw.systemMessage === rawFields.reason && !clean.systemMessage
    ),
  };
}

function recordHookDecision(root, event, rawStdout, sanitizedStdout, payload = {}) {
  const summary = hookDecisionSummary(event, rawStdout, sanitizedStdout, payload);
  if (!summary || !root) return;
  append(path.join(root, 'runtime', 'hme', 'hook-decisions.jsonl'), JSON.stringify(summary));
}

function finalRelay(event, result, body = '{}') {
  const rawStdout = result.stdout || '';
  const stdout = sanitizeStdout(event, rawStdout);
  const payload = parseJson(body);
  recordHookDecision(payload._hme_project_root || process.env.PROJECT_ROOT, event, rawStdout, stdout, payload);
  const stderr = result.stderr && result.stderr.trim() ? result.stderr : '';
  const code = Number.isInteger(result.exit_code) ? result.exit_code : 0;
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  process.exit(code);
}

async function main() {
  const event = process.argv[2] || 'unknown';
  if (LOOP_EVENTS.has(event) && process.env.HME_THREAD_CHILD === '1') process.exit(0);

  const root = resolveRoot();
  process.env.PROJECT_ROOT = root;
  process.env.CODEX_PROJECT_ROOT = root;
  const port = Number(process.env.HME_PROXY_PORT || 9099);
  nudgeSupervisors(root);

  const body = addCodexFields(event, root, await readStdin());
  const watch = watchdog.begin(root, event, body, { host: 'codex' });
  let result = await postLifecycle(port, event, body);
  if (!result) {
    await new Promise((r) => setTimeout(r, 500));
    result = await postLifecycle(port, event, body);
  }

  const ts = new Date().toISOString();
  if (!result) {
    if (maintenanceActive(root)) {
      append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [codex-adapter] proxy unreachable during maintenance (event=${event})`);
      result = { stdout: '', stderr: '', exit_code: 0 };
      watchdog.end(watch, result);
      finalRelay(event, result, body);
      return;
    }
    append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [codex-adapter] ${event} direct fallback (proxy down)`);
    result = await dispatchEvent(event, body);
  } else {
    append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [codex-adapter] ${event} proxied`);
  }

  watchdog.end(watch, result);
  finalRelay(event, result, body);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[codex_adapter] crash: ${err.stack || err.message}\n`);
    process.exit(0);
  });
}

module.exports = { sanitizeStdout, sanitizeHookSpecific, toPermissionRequestOutput, hookDecisionSummary, recordHookDecision };
