#!/usr/bin/env node
/**
 * HME CLI dispatcher -- invokes a worker tool over HTTP.
 *
 * Usage:
 *   node tools/HME/scripts/hme-cli.js <tool-name> [flags...]
 *
 * Via shell wrappers in `i/` (the intended entry point):
 *   i/review  mode=forget
 *   i/learn   query="coupling targets"
 *   i/trace   target=coupling mode=impact section=3
 *   i/evolve  focus=boundaries
 *   i/status
 *   i/hme     <any-tool-name> key=value ...   # generic dispatcher
 *
 * Flag forms (all equivalent where applicable):
 *   key=value       -> {"key":"value"}
 *   --key value     -> {"key":"value"}
 *   --key=value     -> {"key":"value"}
 *   --flag          -> {"flag":true}
 *
 * Values that look numeric (integers or floats) are auto-converted.
 * "true"/"false" become booleans. JSON values ([...]/{...}) are parsed as JSON.
 * Everything else stays a string.
 *
 * To force a value to stay a string (bypass all coercion), prefix with `str:`:
 *   i/learn title=str:42          -> {"title": "42"}  (string, not int)
 *   i/learn tags=str:[a,b]        -> {"tags": "[a,b]"} (string, not parsed JSON)
 * The `str:` prefix is stripped before the value is sent.
 *
 * The worker endpoint is POST http://127.0.0.1:<port>/tool/<name> with the flag
 * map as the JSON body. Returns {ok:true, result:"..."} on success; the result
 * is printed to stdout. Non-200 or {ok:false} responses print to stderr and
 * exit 1.
 *
 * Environment:
 *   HME_WORKER_PORT  Worker port
 *   HME_CLI_HOST     Worker host override
 *   HME_CLI_TIMEOUT_MS  Per-request timeout (default 120000)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const HME_ROOT = path.join(PROJECT_ROOT, 'tools', 'HME');
const { serviceHost, servicePort } = require(path.join(HME_ROOT, 'proxy', 'service_registry'));

// Single source of truth: tools/HME/config/versions.json.
const _VERSIONS_PATH = path.join(HME_ROOT, 'config', 'versions.json');
const CLI_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(_VERSIONS_PATH, 'utf8')).cli; }
  catch (_) { return 'unknown'; }
})();

const HOST = process.env.HME_CLI_HOST || serviceHost('worker');
const PORT = servicePort('worker');
// Timeouts removed per request: handled at lower layers
const TIMEOUT_MS = 0;

function parseArgs(argv) {
  const args = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];

    // Bare `--` is a POSIX arg separator, not a flag. Skip silently -- some
    if (a === '--') { i += 1; continue; }

    // --key=value  or  --key  (boolean)  or  --key value
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        args[a.slice(2, eq)] = coerce(a.slice(eq + 1));
        i += 1;
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--') || next.includes('=')) {
        args[key] = true;
        i += 1;
      } else {
        args[key] = coerce(next);
        i += 2;
      }
      continue;
    }

    // key=value
    const eq = a.indexOf('=');
    if (eq > 0) {
      args[a.slice(0, eq)] = coerce(a.slice(eq + 1));
      i += 1;
      continue;
    }

    throw new Error(`Unrecognized arg "${a}" -- expected key=value, --key value, or --flag`);
  }
  return args;
}

function coerce(v) {
  // Explicit string escape: `str:42` -> "42" (bypass coercion entirely).
  if (v.startsWith('str:')) return v.slice(4);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('{') && v.endsWith('}'))) {
    try { return JSON.parse(v); } catch { /* fall through */ }
    // Shorthand for arrays: `tags=[a,b,c]` should parse as a list of
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      if (inner === '') return [];
      // Naive split on comma -- sufficient for tag-list use case.
      // Strings with literal commas should use proper JSON syntax.
      return inner.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
  }
  return v;
}

function postTool(name, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args);
    // Client-side wall-clock timeout. Historical default was NONE, which
    let timeoutMs = Number(process.env.HME_CLI_TIMEOUT_MS) || 150_000;
    if (name === 'hme_admin' && ['index', 'clear_index'].includes(String(args.action || ''))) {
      timeoutMs = Math.max(timeoutMs, Number(process.env.HME_INDEX_CLI_TIMEOUT_MS) || 900_000);
    }
    const req = http.request({
      host: HOST,
      port: PORT,
      path: '/tool/' + encodeURIComponent(name),
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          reject(new Error(`worker returned non-JSON (status ${res.statusCode}): ${chunks.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`hme-cli: request '${name}' exceeded ${timeoutMs}ms -- worker hung or slow`));
    });
    req.write(body);
    req.end();
  });
}

function _getVersion(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: '/version', method: 'GET', timeout: timeoutMs },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(chunks)); } catch (_) { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}
function getWorkerVersion(timeoutMs) { return _getVersion(HOST, PORT, timeoutMs); }
function getProxyVersion(timeoutMs) {
  return _getVersion(serviceHost('proxy'), servicePort('proxy'), timeoutMs);
}

function logFallback(message) {
  try {
    const file = path.join(PROJECT_ROOT, 'log', 'hme-cli-fallback.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
  } catch (_) { /* best-effort */ }
}

/**
 * Direct-lance fallback for read-only KB tools. Spawns
 * `python3 tools/HME/service/direct_lance.py` with the appropriate subcommand
 * and parses the JSON output. Returns null when:
 *   - the tool is not a read-only KB query (mutating tools require the worker)
 *   - lancedb is not installed (Python ImportError surfaces as empty output)
 *   - the lance shard doesn't exist
 *
 * Caller treats null as "fallback unavailable" and surfaces the original
 * worker-down error.
 */
function _tryDirectLance(tool, args) {
  return new Promise((resolve) => {
    const projectRoot = PROJECT_ROOT;
    const directLance = path.join(HME_ROOT, 'service', 'direct_lance.py');
    if (!fs.existsSync(directLance)) return resolve(null);

    let scriptArgs;
    if (tool === 'list_knowledge' || tool === 'knowledge_list') {
      scriptArgs = ['list', '--limit', String((args && args.limit) || 20)];
      if (args && args.category) scriptArgs.push('--category', String(args.category));
    } else if (tool === 'knowledge_count') {
      scriptArgs = ['count'];
    } else if (tool === 'knowledge_lookup_id' || tool === 'knowledge_get') {
      const id = args && (args.knowledge_id || args.id);
      if (!id) return resolve(null);
      scriptArgs = ['lookup', String(id)];
    } else {
      return resolve(null); // tool not in the read-only fallback set
    }

    const child = spawn('python3', [directLance, ...scriptArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PROJECT_ROOT: projectRoot },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch (_) {} resolve(null); }, 15_000);
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) return resolve(null);
      try { resolve(JSON.parse(stdout)); }
      catch (_e) { resolve(null); }
    });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const tool = argv[0];
  if (!tool || tool === '--help' || tool === '-h') {
    console.error('Usage: hme-cli <tool> [key=value | --key value | --flag]...');
    console.error('Tools: review, learn, trace, evolve, hme_admin, status, agent');
    console.error(`hme-cli version: ${CLI_VERSION}`);
    process.exit(tool ? 0 : 1);
  }
  if (tool === '--version' || tool === '-v') {
    const [wv, pv] = await Promise.all([getWorkerVersion(3000), getProxyVersion(3000)]);
    console.log(`hme-cli: ${CLI_VERSION}`);
    console.log(`proxy:   ${pv ? (pv.version || '(no version field)') : '(unreachable)'}`);
    console.log(`worker:  ${wv ? (wv.version || '(no version field)') : '(unreachable)'}`);
    const versions = [CLI_VERSION, pv && pv.version, wv && wv.version].filter(Boolean);
    const allMatch = versions.length >= 2 && versions.every((v) => v === versions[0]);
    if (!allMatch && versions.length >= 2) {
      console.error(`WARNING: version mismatch -- restart the proxy after updating hme-cli`);
    }
    process.exit(0);
  }
  let args;
  try {
    args = parseArgs(argv.slice(1));
  } catch (e) {
    console.error(`hme-cli: ${e.message}`);
    process.exit(1);
  }

  let res;
  try {
    res = await postTool(tool, args);
  } catch (e) {
    // HTTP failed -- fall back to filesystem-IPC queue. The queue path
    if (process.env.HME_CLI_DISABLE_QUEUE !== '1') {
      try {
        const wq = require(path.join(HME_ROOT, 'proxy', 'worker_queue'));
        const queueTimeoutMs = Number(process.env.HME_CLI_QUEUE_TIMEOUT_MS) || 60_000;
        const queueRes = await wq.call('tool', { name: tool, args }, { timeoutMs: queueTimeoutMs });
        if (queueRes !== null) {
          logFallback(`HTTP failed (${e.message}) -- queue path succeeded for ${tool}`);
          res = { status: queueRes.ok ? 200 : 500, body: queueRes };
        } else {
          // Queue timed out -> try direct-lance fallback for read-only KB tools.
          const directRes = await _tryDirectLance(tool, args);
          if (directRes !== null) {
            logFallback(`HTTP+queue failed -- direct-lance fallback succeeded for read-only ${tool}`);
            res = { status: 200, body: { ok: true, result: directRes } };
          } else {
            console.error(`hme-cli: HTTP failed (${e.message}); queue path timed out after ${queueTimeoutMs}ms; direct-lance not available for ${tool}`);
            console.error(`  worker: http://${HOST}:${PORT}  (HME_WORKER_PORT=${PORT})`);
            console.error(`  is the worker process alive? \`ps -ef | grep worker.py\``);
            process.exit(1);
          }
        }
      } catch (qErr) {
        console.error(`hme-cli: HTTP failed (${e.message}); queue fallback errored: ${qErr.message}`);
        console.error(`  worker: http://${HOST}:${PORT}  (HME_WORKER_PORT=${PORT})`);
        process.exit(1);
      }
    } else {
      console.error(`hme-cli: request failed -- ${e.message}`);
      console.error(`  worker: http://${HOST}:${PORT}  (HME_WORKER_PORT=${PORT})`);
      console.error(`  is the proxy running? \`curl http://${HOST}:${PORT}/health\` should return status:ready`);
      process.exit(1);
    }
  }

  if (res.status !== 200 || res.body.ok === false) {
    console.error(`hme-cli: ${tool} failed (status ${res.status}):`);
    console.error(res.body.error || JSON.stringify(res.body));
    if (res.body.trace) console.error(res.body.trace);
    process.exit(1);
  }

  const out = res.body.result;
  if (typeof out === 'string') process.stdout.write(out + (out.endsWith('\n') ? '' : '\n'));
  else process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main();
