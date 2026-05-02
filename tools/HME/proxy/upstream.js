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

// OAuth token refresh (modelled on horselock/claude-code-proxy). Single
// in-flight refresh promise so a burst of 401s doesn't trigger N parallel
// refreshes against console.anthropic.com/v1/oauth/token. Returns the new
// access token (without the "Bearer " prefix) on success, throws on
// failure. Updates ~/.claude/.credentials.json so future reads pick up
// the new token. The Claude Code OAuth client_id is public/well-known.
const _CC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
let _refreshPromise = null;

async function refreshOauthToken() {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const os = require('os');
    const https = require('https');
    const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const credsRaw = fs.readFileSync(credsPath, 'utf8');
    const creds = JSON.parse(credsRaw);
    const refreshToken = creds && creds.claudeAiOauth && creds.claudeAiOauth.refreshToken;
    if (!refreshToken) throw new Error('no refresh_token in credentials.json');
    const body = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: _CC_OAUTH_CLIENT_ID,
    });
    const resp = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'console.anthropic.com',
        port: 443,
        path: '/v1/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'hme-proxy/1.0.0',
        },
      }, (r) => {
        const cs = [];
        r.on('data', (c) => cs.push(c));
        r.on('end', () => resolve({ statusCode: r.statusCode, body: Buffer.concat(cs).toString('utf8') }));
        r.on('error', reject);
      });
      req.setTimeout(10_000, () => req.destroy(new Error('refresh timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (resp.statusCode !== 200) {
      throw new Error(`refresh HTTP ${resp.statusCode}: ${resp.body.slice(0, 300)}`);
    }
    const parsed = JSON.parse(resp.body);
    creds.claudeAiOauth.accessToken = parsed.access_token;
    if (parsed.refresh_token) creds.claudeAiOauth.refreshToken = parsed.refresh_token;
    if (parsed.expires_in) creds.claudeAiOauth.expiresAt = Date.now() + (parsed.expires_in * 1000);
    fs.writeFileSync(credsPath, JSON.stringify(creds), { mode: 0o600 });
    console.error('[hme-proxy] OAuth token refreshed successfully');
    return parsed.access_token;
  })().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

module.exports = {
  resolveUpstream,
  recordUpstreamSuccess,
  recordUpstreamFailure,
  isPassthroughMode,
  refreshOauthToken,
  DEFAULT_UPSTREAM_HOST,
  DEFAULT_UPSTREAM_PORT,
  DEFAULT_UPSTREAM_TLS,
};
