'use strict';
// Upstream routing: provider resolution, emergency valve, failure tracking.

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');
const { loadEnv, requireEnv, requireEnvInt, requireEnvBool } = require('./shared/load_env');

loadEnv(path.resolve(__dirname, '..', '..', '..', '.env'));

const DEFAULT_UPSTREAM_HOST = requireEnv('HME_PROXY_UPSTREAM_HOST');
const DEFAULT_UPSTREAM_PORT = requireEnvInt('HME_PROXY_UPSTREAM_PORT');
const DEFAULT_UPSTREAM_TLS = requireEnvBool('HME_PROXY_UPSTREAM_TLS');

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
    // silent-ok: optional fallback path.
    return { host: DEFAULT_UPSTREAM_HOST, port: DEFAULT_UPSTREAM_PORT, tls: DEFAULT_UPSTREAM_TLS, provider: 'anthropic' };
  }
}

// Emergency valve. First upstream failure trips into passthrough +
const EMERGENCY_THRESHOLD = 1;
const BACKOFF_SCHEDULE_MS = [60_000, 120_000, 300_000, 600_000];
const SUCCESS_RESET_MS = 300_000;  // 5 min clean = back to first backoff
let _consecutiveFailures = 0;
let _valveTripped = false;
let _valveTrippedAt = 0;
let _trippedSequence = 0;  // index into BACKOFF_SCHEDULE_MS, capped
let _lastSuccessAt = 0;

// Persisted across watchdog respawns (which bypass polychron-shutdown.sh).
const _VALVE_STATE_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-proxy-valve-state.json');

function _loadPersistedValveState() {
  try {
    const raw = fs.readFileSync(_VALVE_STATE_FILE, 'utf8');
    const s = JSON.parse(raw);
    if (typeof s.trippedAt !== 'number' || typeof s.sequence !== 'number') return;
    // Treat already-elapsed backoff as clean (don't start in passthrough).
    const idx = Math.min(s.sequence, BACKOFF_SCHEDULE_MS.length - 1);
    const elapsed = Date.now() - s.trippedAt;
    if (elapsed >= BACKOFF_SCHEDULE_MS[idx]) {
      try { fs.unlinkSync(_VALVE_STATE_FILE); } catch (_e) { /* ignore */ }
      return;
    }
    _valveTripped = true;
    _valveTrippedAt = s.trippedAt;
    _trippedSequence = s.sequence;
    console.error(`inherited valve trip from prior process (sequence=${s.sequence}, ${Math.round((BACKOFF_SCHEDULE_MS[idx] - elapsed)/1000)}s remaining)`);
  } catch (_e) { /* no persisted state -- normal first boot */ }
}

function _persistValveState() {
  try {
    fs.mkdirSync(path.dirname(_VALVE_STATE_FILE), { recursive: true });
    fs.writeFileSync(_VALVE_STATE_FILE, JSON.stringify({
      trippedAt: _valveTrippedAt,
      sequence: _trippedSequence,
    }));
  } catch (_e) { /* best effort */ }
}

function _clearPersistedValveState() {
  try { fs.unlinkSync(_VALVE_STATE_FILE); } catch (_e) { /* not present */ }
}

_loadPersistedValveState();

function _currentBackoffMs() {
  const idx = Math.min(_trippedSequence, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx];
}

function isPassthroughMode() {
  if (process.env.HME_PROXY_FORCE_PASSTHROUGH === '1') return true;
  if (!_valveTripped) return false;
  // Auto-clear after backoff; next failure re-trips at the next level.
  const elapsed = Date.now() - _valveTrippedAt;
  if (elapsed >= _currentBackoffMs()) {
    _valveTripped = false;
    _clearPersistedValveState();
    console.error(`valve auto-cleared after ${Math.round(elapsed/1000)}s backoff -- attempting proxy path on next request`);
    emit({ event: 'proxy_emergency_cleared', source: 'emergency_valve', backoff_ms: _currentBackoffMs() });
    return false;
  }
  return true;
}

function tripEmergencyValve(lastErr) {
  // OVERDRIVE_MODE=1: never enter passthrough (would leak to api.anthropic.com).
  if (process.env.OVERDRIVE_MODE === '1') {
    console.error(`[hme-proxy] MODE=${process.env.OVERDRIVE_MODE}: suppressing escape-hatch trip (Anthropic-free mode). Error: ${lastErr}`);
    return;
  }
  if (_valveTripped) return;
  _valveTripped = true;
  _valveTrippedAt = Date.now();
  const backoffSec = Math.round(_currentBackoffMs() / 1000);
  const ts = new Date(_valveTrippedAt).toISOString();
  const banner = `PROXY 400/4xx ESCAPE HATCH TRIPPED -- proxy in PASSTHROUGH mode for ~${backoffSec}s (backoff sequence ${_trippedSequence + 1}/${BACKOFF_SCHEDULE_MS.length}, auto-clears after window). Upstream rejected a proxy-mutated request: ${lastErr}. If this re-trips quickly, inspect tmp/claude-400-payload-*.json and fix the proxy mutation.`;
  console.error(`${banner}`);

  // LIFESAVER channel: lifesaver_inject reads hme-errors.log per request.
  const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
  try {
    fs.appendFileSync(errLog, `[${ts}] PROXY_EMERGENCY: ${banner}\n`);
  } catch (_e) { /* best effort */ }

  emit({ event: 'proxy_emergency', reason: lastErr, source: 'emergency_valve', backoff_ms: _currentBackoffMs(), sequence: _trippedSequence + 1 });

  // Persist BEFORE escalating sequence (watchdog-respawn safety).
  _persistValveState();

  // Escalate the backoff schedule for the NEXT trip. Cap at the last entry.
  _trippedSequence = Math.min(_trippedSequence + 1, BACKOFF_SCHEDULE_MS.length - 1);
}

function recordUpstreamSuccess() {
  _consecutiveFailures = 0;
  const now = Date.now();
  // Sustained success resets the backoff escalation.
  if (_lastSuccessAt > 0 && now - _lastSuccessAt < SUCCESS_RESET_MS) {
    // Recent success -- update timestamp and check reset condition.
    if (_trippedSequence > 0 && now - _valveTrippedAt > SUCCESS_RESET_MS) {
      _trippedSequence = 0;
    }
  }
  _lastSuccessAt = now;
}

function recordUpstreamFailure(err) {
  _consecutiveFailures++;
  if (_consecutiveFailures >= EMERGENCY_THRESHOLD) {
    tripEmergencyValve(err);
  }
}

// OAuth refresh -- single in-flight promise so 401-bursts don't fan out.
// Updates ~/.claude/.credentials.json. Client_id is public/well-known.
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
    console.error('OAuth token refreshed successfully');
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
