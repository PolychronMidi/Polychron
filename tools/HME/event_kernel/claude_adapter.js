#!/usr/bin/env node
'use strict';
/**
 * Claude Code adapter for the HME event kernel.
 *
 * This is intentionally transport-only:
 *   - read Claude hook JSON from stdin
 *   - add small Claude-specific envelope fields
 *   - try proxy /hme/lifecycle
 *   - fall back to the local event kernel when the proxy is unavailable
 *   - translate the kernel result to Claude's stdout/stderr/exit protocol
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { dispatchEvent } = require('./dispatcher');
const { nudgeSupervisors } = require('./supervisors');

const LOOP_EVENTS = new Set(['Stop', 'UserPromptSubmit', 'SessionStart', 'PreCompact', 'PostCompact']);
const MAX_STDIN_BYTES = 1024 * 1024;

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.on('data', (chunk) => {
      input += chunk.toString('utf8');
      if (input.length > MAX_STDIN_BYTES) {
        process.stderr.write(`[claude_adapter] stdin exceeded ${MAX_STDIN_BYTES} bytes\n`);
        process.exit(0);
      }
    });
    process.stdin.on('end', () => resolve(input || '{}'));
  });
}

function resolveRoot() {
  const candidates = [process.env.PROJECT_ROOT, process.env.CLAUDE_PROJECT_DIR].filter(Boolean);
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

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
}

function newestJsonl(dir) {
  try {
    const rows = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return rows[0] ? rows[0].f : '';
  } catch (_e) {
    return '';
  }
}

function addClaudeFields(event, root, body) {
  const payload = parseJson(body);
  if (event === 'Stop') {
    const ccDir = path.join(path.dirname(root), '.claude', 'projects', '-home-jah-Polychron');
    const transcript = newestJsonl(ccDir) || path.join(root, 'log', 'session-transcript.jsonl');
    if (fs.existsSync(transcript)) {
      payload.transcript_path = transcript;
      try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${transcript}\n`); } catch (_e) { /* best effort */ }
    }
  }
  if (process.env.HME_TEAM_ROLE) payload._hme_team_role = process.env.HME_TEAM_ROLE;
  return JSON.stringify(payload);
}

function postLifecycle(port, event, body, timeoutMs = 60_000) {
  const payload = Buffer.from(body);
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: `/hme/lifecycle?event=${encodeURIComponent(event)}`,
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

function append(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`);
}

function proxyDownBanner(port) {
  return `[ALERT] LIFESAVER - HME PROXY OFFLINE - LOCAL EVENT KERNEL ACTIVE

The HME proxy on 127.0.0.1:${port} is not responding. Claude hook events are
running through the local event kernel fallback. Proxy-only request middleware is
offline until the proxy restarts.

Restart: node tools/HME/proxy/hme_proxy.js
Check:   curl -sf http://127.0.0.1:${port}/health`;
}

function denyReason(stdout) {
  if (!stdout) return '';
  try {
    const parsed = JSON.parse(stdout);
    return parsed.reason
      || parsed.message
      || (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecisionReason)
      || '';
  } catch (_e) {
    return '';
  }
}

function finalRelay(event, result) {
  let stdout = result.stdout || '';
  let stderr = result.stderr || '';
  let code = Number.isInteger(result.exit_code) ? result.exit_code : 0;

  if (stdout.includes('STREAK_RESET') || stderr.includes('BLOCKED: Raw tool streak')) {
    if (!stdout) {
      stdout = 'NOTICE: My raw tool streak is too high. To continue, I must run an HME command such as `i/review mode=forget` or use native Read to refresh context.';
    }
    stderr = 'Streak limit hit. Redirecting agent to HME tools.';
    code = 0;
  }

  if ((event === 'PreToolUse' || event === 'Stop') && code === 0) {
    const reason = denyReason(stdout);
    if (reason) {
      code = 2;
      stderr = reason;
      process.stderr.write(`${reason}\n`);
    }
  }
  if (code === 0 && !stderr) stderr = ' ';

  process.stdout.write(JSON.stringify({ stdout, stderr, exit_code: code }));
  process.exit(code);
}

async function main() {
  const event = process.argv[2] || 'unknown';
  if (LOOP_EVENTS.has(event) && process.env.HME_THREAD_CHILD === '1') process.exit(0);

  const root = resolveRoot();
  process.env.PROJECT_ROOT = root;
  const port = Number(process.env.HME_PROXY_PORT || 9099);
  nudgeSupervisors(root);

  const body = addClaudeFields(event, root, await readStdin());
  let result = await postLifecycle(port, event, body);
  if (!result) {
    await new Promise((r) => setTimeout(r, 500));
    result = await postLifecycle(port, event, body);
  }

  const ts = new Date().toISOString();
  if (!result) {
    if (maintenanceActive(root)) {
      append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [claude-adapter] proxy unreachable during maintenance (event=${event})`);
      finalRelay(event, { stdout: '', stderr: ' ', exit_code: 0 });
      return;
    }
    append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [claude-adapter] ${event} direct fallback (proxy down)`);
    writeJsonAtomic(path.join(root, 'tmp', 'hme-proxy-down.flag'), `[${ts}] [claude-adapter] proxy unreachable; ${event} ran in direct mode\n`);
    result = await dispatchEvent(event, body);
    if (event === 'SessionStart' || event === 'UserPromptSubmit') {
      const banner = proxyDownBanner(port);
      result.stdout = result.stdout || JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: banner },
        systemMessage: banner,
      });
    }
  } else {
    const flag = path.join(root, 'tmp', 'hme-proxy-down.flag');
    if (fs.existsSync(flag)) {
      try { fs.unlinkSync(flag); } catch (_e) { /* best effort */ }
      append(path.join(root, 'log', 'hme-proxy-lifecycle.log'), `[${ts}] [claude-adapter] proxy recovered on 127.0.0.1:${port} (event=${event})`);
    }
  }

  finalRelay(event, result);
}

main().catch((err) => {
  process.stderr.write(`[claude_adapter] crash: ${err.stack || err.message}\n`);
  process.exit(0);
});
