'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { PROJECT_ROOT } = require('../../proxy/shared');
const { spawnFileInputSync } = require('../fs_ipc');

function hookBlock(reason) {
  return { stdout: JSON.stringify({ decision: 'block', reason }), stderr: ' ', exit_code: 2 };
}

function allow(stdout = '', stderr = ' ') {
  return { stdout, stderr, exit_code: 0 };
}

function parse(stdinJson) {
  try { return JSON.parse(stdinJson || '{}'); } catch (_e) { return {}; }
}

function toolInput(stdinJson) {
  const payload = parse(stdinJson);
  return payload.tool_input || {};
}

function appendUnique(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_e) { /* missing */ }
  if (!text.split(/\r?\n/).includes(line)) fs.appendFileSync(file, `${line}\n`);
}

function extractBgOutputPath(payload) {
  const result = payload.tool_result || payload.tool_response || '';
  const text = Array.isArray(result)
    ? result.map((x) => (x && typeof x === 'object') ? (x.text || '') : String(x)).join(' ')
    : (typeof result === 'object' ? JSON.stringify(result) : String(result || ''));
  const m = text.match(/Output is being written to: (\S+)/);
  return m ? m[1] : '';
}

function runPython(args, input = '', timeoutMs = 30_000, label = 'python') {
  if (input) {
    return spawnFileInputSync('python3', args, {
      input,
      timeoutMs,
      cwd: PROJECT_ROOT,
      env: { PROJECT_ROOT },
      label,
    });
  }
  const result = spawnSync('python3', args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exit_code: Number.isInteger(result.status) ? result.status : (result.error ? -1 : 0),
    signal: result.signal || null,
    error: result.error || null,
  };
}

function runNodeTool(command, args, timeoutMs = 20_000) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exit_code: Number.isInteger(result.status) ? result.status : (result.error ? -1 : 0),
    signal: result.signal || null,
    error: result.error || null,
  };
}

function httpGetOk(port, route) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

function httpPostJson(port, route, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      timeout: 2000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  });
}

module.exports = {
  PROJECT_ROOT,
  allow,
  appendUnique,
  extractBgOutputPath,
  fs,
  hookBlock,
  httpGetOk,
  httpPostJson,
  parse,
  path,
  runNodeTool,
  runPython,
  toolInput,
};
