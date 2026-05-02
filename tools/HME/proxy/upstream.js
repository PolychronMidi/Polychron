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

//  Emergency valve
// N consecutive upstream failures -> flip into sticky passthrough mode.
// Was: process.exit(99) + write HME_PROXY_ENABLED=0 to .env. That left
// Claude Code pointed at a now-dead 127.0.0.1:9099 (ECONNREFUSED on every
// retry) -- the "escape hatch" stranded the user instead of saving them.
// Now: stay alive, mark the valve tripped, and forward every subsequent
// request as raw bytes without any HME mutation. Claude Code keeps
// working; HME enrichment is the only thing lost. The .env flag still
// flips so an operator-level restart re-validates the config.
const EMERGENCY_THRESHOLD = 3;
let _consecutiveFailures = 0;
let _valveTripped = false;

function isPassthroughMode() {
  return _valveTripped;
}

function tripEmergencyValve(lastErr) {
  if (_valveTripped) return;
  _valveTripped = true;
  const msg = `EMERGENCY VALVE: switched to PASSTHROUGH mode after ${EMERGENCY_THRESHOLD} consecutive upstream failures. All HME mutations disabled until proxy restart. Last error: ${lastErr}.`;
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
      'HME_PROXY_ENABLED=0  # EMERGENCY VALVE tripped -- proxy in passthrough mode (restart to re-enable HME)',
    );
    fs.writeFileSync(envPath, envContent);
  } catch (_e) {
    console.error('[hme-proxy] WARNING: could not update .env -- manually set HME_PROXY_ENABLED=0');
  }

  emit({ event: 'proxy_emergency', reason: lastErr, source: 'emergency_valve' });
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
  isPassthroughMode,
  DEFAULT_UPSTREAM_HOST,
  DEFAULT_UPSTREAM_PORT,
  DEFAULT_UPSTREAM_TLS,
};
