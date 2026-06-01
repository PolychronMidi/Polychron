#!/usr/bin/env node
'use strict';

// Read-only active-active proxy availability smoke. It never starts, stops,
// reloads, drains, or edits proxy slots; it only observes the shuffler and the

const fs = require('fs');
const path = require('path');
const http = require('http');

function loadDotEnv(root) {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, m[1])) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

function requestJson(port, route, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: route, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch (_e) { json = null; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
  });
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { return { _read_error: `${err.name}: ${err.message}` }; }
}

async function main() {
  const root = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
  loadDotEnv(root);
  const shufflerPort = Number(process.env.HME_PROXY_PORT || 9099);
  const slotPorts = {
    a: Number(process.env.HME_PROXY_BACKEND_A_PORT || 9100),
    b: Number(process.env.HME_PROXY_BACKEND_B_PORT || 9101),
  };
  const runtimeDir = path.join(root, 'tools', 'HME', 'runtime');
  const healthFiles = {
    a: path.join(runtimeDir, 'proxy-a.health'),
    b: path.join(runtimeDir, 'proxy-b.health'),
  };

  const shuffler = await requestJson(shufflerPort, '/shuffler/health');
  const slots = {};
  for (const [slot, port] of Object.entries(slotPorts)) {
    slots[slot] = {
      port,
      direct: await requestJson(port, '/health'),
      file: readJsonFile(healthFiles[slot]),
    };
  }

  const failures = [];
  if (!shuffler.ok || !shuffler.json) {
    failures.push(`shuffler /shuffler/health not healthy on ${shufflerPort}: status=${shuffler.status || 0} ${shuffler.error || ''}`.trim());
  } else {
    const routable = Number(shuffler.json.routable_count || 0);
    if (routable < 1) failures.push(`constant availability violated: routable_count=${routable}`);
    for (const slot of ['a', 'b']) {
      const backend = shuffler.json.backends && shuffler.json.backends[slot];
      if (!backend) {
        failures.push(`missing shuffler backend record for slot ${slot}`);
        continue;
      }
      if (backend.routable) {
        if (!backend.health || backend.health.ready !== true || backend.health.draining) {
          failures.push(`slot ${slot} marked routable without ready/non-draining health`);
        }
        if (!slots[slot].direct.ok) {
          failures.push(`routable slot ${slot} direct /health failed: status=${slots[slot].direct.status || 0} ${slots[slot].direct.error || ''}`.trim());
        }
      }
    }
  }

  const out = {
    ok: failures.length === 0,
    invariant: 'constant-availability: shuffler must expose at least one ready non-draining routable slot; smoke is read-only',
    shuffler_port: shufflerPort,
    slot_ports: slotPorts,
    shuffler,
    slots,
    failures,
  };
  console.log(JSON.stringify(out, null, 2));
  return failures.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`proxy-availability-smoke failed: ${err.stack || err.message}`);
  process.exit(1);
});
