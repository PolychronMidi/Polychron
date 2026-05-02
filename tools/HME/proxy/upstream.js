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
// FIRST upstream failure -> flip into sticky passthrough mode + write
// LIFESAVER alert with the full error text + flip HME_PROXY_ENABLED=0.
// Threshold was 3 consecutive failures; lowered to 1 because the user
// shouldn't have to hit the same proxy-induced rejection three times
// before the auto-bypass kicks in. The lifesaver alert is the loudest
// signal we have -- it surfaces in the next userpromptsubmit and on
// every subsequent /v1/messages until the operator clears it.
const EMERGENCY_THRESHOLD = 1;
let _consecutiveFailures = 0;
let _valveTripped = false;

function isPassthroughMode() {
  return _valveTripped;
}

function tripEmergencyValve(lastErr) {
  if (_valveTripped) return;
  _valveTripped = true;
  const ts = new Date().toISOString();
  const banner = `PROXY 400/4xx ESCAPE HATCH TRIPPED -- proxy now in PASSTHROUGH mode for the rest of this process lifetime. Upstream rejected a proxy-mutated request: ${lastErr}. Inspect tmp/claude-400-payload-*.json for the exact body Anthropic rejected, fix the proxy mutation, and restart with tools/HME/launcher/polychron-restart.sh.`;
  console.error(`[hme-proxy] ${banner}`);

  // LIFESAVER channel: hme-errors.log is read by lifesaver_inject every
  // /v1/messages and userpromptsubmit; the new line surfaces in the next
  // user-visible turn until the operator clears the watermark.
  const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
  try {
    fs.appendFileSync(errLog, `[${ts}] PROXY_EMERGENCY: ${banner}\n`);
  } catch (_e) { /* best effort */ }

  // The previous valve-trip path also wrote `HME_PROXY_ENABLED=0` to .env
  // as a "persistent visibility" signal. That bit user repeatedly: every
  // restart inherited the disabled flag, locking them in passthrough until
  // they manually fixed the env file. The in-memory _valveTripped already
  // covers the current process's lifetime; a fresh restart should be a
  // clean slate. Keep the lifesaver+console signals (loud enough), drop
  // the .env mutation.

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
