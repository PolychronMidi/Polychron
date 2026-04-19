#!/usr/bin/env node
/**
 * HME CLI dispatcher -- invokes a worker tool over HTTP.
 *
 * Usage:
 *   node scripts/hme-cli.js <tool-name> [flags...]
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
 *   HME_MCP_PORT  Worker port (default 9098)
 *   HME_CLI_HOST  Worker host (default 127.0.0.1)
 *   HME_CLI_TIMEOUT_MS  Per-request timeout (default 120000)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// Single source of truth: tools/HME/config/versions.json.
// Bump that file when the wire protocol between cli/proxy/worker changes —
// all three components read from it so they can't silently drift apart.
const _VERSIONS_PATH = path.resolve(__dirname, '..', 'tools', 'HME', 'config', 'versions.json');
const CLI_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(_VERSIONS_PATH, 'utf8')).cli; }
  catch (_) { return 'unknown'; }
})();

const HOST = process.env.HME_CLI_HOST || '127.0.0.1';
const PORT = Number(process.env.HME_MCP_PORT || 9098);
// Timeouts removed per request: handled at lower layers
const TIMEOUT_MS = 0;

function parseArgs(argv) {
  const args = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];

    // Bare `--` is a POSIX arg separator, not a flag. Skip silently -- some
    // callers (e.g. habits from npm-run-script days) pass it before the real
    // args: `i/review -- mode=forget`. Without this, `--` would be parsed as
    // --<empty-key> and crash the worker.
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
  }
  return v;
}

function postTool(name, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args);
    const req = http.request({
      host: HOST,
      port: PORT,
      path: '/tool/' + encodeURIComponent(name),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      // No client-side timeout: handled by worker/network stack
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
    // Client-side timeout disabled entirely
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
  const proxyPort = Number(process.env.HME_PROXY_PORT || 9099);
  return _getVersion(HOST, proxyPort, timeoutMs);
}

async function main() {
  const argv = process.argv.slice(2);
  const tool = argv[0];
  if (!tool || tool === '--help' || tool === '-h') {
    console.error('Usage: hme-cli <tool> [key=value | --key value | --flag]...');
    console.error('Tools: review, learn, trace, evolve, hme_admin, status, hme_todo, read, agent');
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
      console.error(`WARNING: version mismatch — restart the proxy after updating hme-cli`);
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
    console.error(`hme-cli: request failed -- ${e.message}`);
    console.error(`  worker: http://${HOST}:${PORT}  (HME_MCP_PORT=${PORT})`);
    console.error(`  is the proxy running? \`curl http://${HOST}:${PORT}/health\` should return status:ready`);
    process.exit(1);
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
