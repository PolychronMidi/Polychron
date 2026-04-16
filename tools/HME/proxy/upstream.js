'use strict';
// Upstream routing: provider resolution, emergency valve, failure tracking.

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');

const DEFAULT_UPSTREAM_HOST = process.env.HME_PROXY_UPSTREAM_HOST || 'api.anthropic.com';
const DEFAULT_UPSTREAM_PORT = parseInt(process.env.HME_PROXY_UPSTREAM_PORT || '443', 10);
const DEFAULT_UPSTREAM_TLS = (process.env.HME_PROXY_UPSTREAM_TLS ?? '1') !== '0';

// Callers pass `X-HME-Upstream: https://api.groq.com` to route through a
// non-default upstream. Claude Code omits this header and hits the Anthropic default.
function resolveUpstream(req) {
  const header = req.headers['x-hme-upstream'];
  if (!header) {
    return { host: DEFAULT_UPSTREAM_HOST, port: DEFAULT_UPSTREAM_PORT, tls: DEFAULT_UPSTREAM_TLS, provider: 'anthropic' };
  }
  try {
    const u = new URL(header.startsWith('http') ? header : `https://${header}`);
    const tls = u.protocol === 'https:';
    const port = u.port ? parseInt(u.port, 10) : (tls ? 443 : 80);
    const hostParts = u.hostname.split('.');
    const provider = hostParts.length >= 2 ? hostParts[hostParts.length - 2] : u.hostname;
    return { host: u.hostname, port, tls, provider, basePath: u.pathname !== '/' ? u.pathname : '' };
  } catch (_err) {
    return { host: DEFAULT_UPSTREAM_HOST, port: DEFAULT_UPSTREAM_PORT, tls: DEFAULT_UPSTREAM_TLS, provider: 'anthropic' };
  }
}

// ── Emergency valve ──────────────────────────────────────────────────────────
// N consecutive upstream failures → write CRITICAL alert, disable proxy, exit.
const EMERGENCY_THRESHOLD = 3;
let _consecutiveFailures = 0;
let _valveTripped = false;

function tripEmergencyValve(lastErr) {
  if (_valveTripped) return;
  _valveTripped = true;
  const msg = `EMERGENCY VALVE: proxy killed after ${EMERGENCY_THRESHOLD} consecutive upstream failures. Last error: ${lastErr}. HME_PROXY_ENABLED set to 0.`;
  console.error(`[hme-proxy] ${msg}`);

  const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(errLog, `[${ts}] PROXY_EMERGENCY: ${msg}\n`);
  } catch (_e) { /* best effort */ }

  const envPath = path.join(PROJECT_ROOT, '.env');
  try {
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(
      /^HME_PROXY_ENABLED=.*/m,
      'HME_PROXY_ENABLED=0  # EMERGENCY VALVE tripped — proxy self-disabled',
    );
    fs.writeFileSync(envPath, envContent);
  } catch (_e) {
    console.error('[hme-proxy] WARNING: could not update .env — manually set HME_PROXY_ENABLED=0');
  }

  emit({ event: 'proxy_emergency', reason: lastErr, source: 'emergency_valve' });
  setTimeout(() => process.exit(99), 500);
}

function recordUpstreamSuccess() {
  _consecutiveFailures = 0;
}

function recordUpstreamFailure(err) {
  _consecutiveFailures++;
  if (_consecutiveFailures >= EMERGENCY_THRESHOLD) {
    tripEmergencyValve(err);
  }
}

module.exports = {
  resolveUpstream,
  recordUpstreamSuccess,
  recordUpstreamFailure,
  DEFAULT_UPSTREAM_HOST,
  DEFAULT_UPSTREAM_PORT,
  DEFAULT_UPSTREAM_TLS,
};
