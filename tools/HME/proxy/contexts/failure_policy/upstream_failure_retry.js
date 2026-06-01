'use strict';

const { emit, PROJECT_ROOT } = require('../../shared');
const {
  refreshOauthToken,
  omniProviderForConfigProvider,
} = require('../upstream_dispatch');
const omniroute = require('../upstream_dispatch').omnirouteClient;
const swapStore = require('../upstream_dispatch').swapStore;
const { upstreamModelId } = require('./hme_proxy_codex');
const { detectUpstreamFailure } = require('./failure_classification');
const { markRouteCooldown } = require('./model_route_health');
const { recordSuccessAndReset } = require('./upstream_failure_state');

const OMNIROUTE_OAUTH_PROVIDERS = new Set(['claude', 'anthropic', 'cx', 'codex']);

function requestBuffer({ transport, opts, body }) {
  return new Promise((resolve, reject) => {
    const req = transport.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode || 502,
        statusCode: res.statusCode || 502,
        headers: { ...res.headers },
        body: Buffer.concat(chunks),
        fullBody: Buffer.concat(chunks),
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function refreshOmniRouteProviderOnRateLimit({ omniProvider }) {
  if (!OMNIROUTE_OAUTH_PROVIDERS.has(String(omniProvider || '').toLowerCase())) return false;
  const password = process.env.OMNIROUTE_ADMIN_PASSWORD || 'polychron';
  const baseUrl = `http://127.0.0.1:${omniroute.port()}`;
  const cookieHeader = await new Promise((resolve) => {
    const req = require('http').request(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
      res.resume();
      res.on('end', () => resolve(cookie));
    });
    req.on('error', () => resolve(''));
    req.write(JSON.stringify({ password }));
    req.end();
  });
  if (!cookieHeader) return false;
  const list = await new Promise((resolve) => {
    const req = require('http').request(`${baseUrl}/api/providers`, {
      method: 'GET',
      headers: { Cookie: cookieHeader },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (_e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
  const connections = list && Array.isArray(list.connections) ? list.connections : [];
  const target = connections.find((c) => c && c.provider === omniProvider && c.authType === 'oauth' && c.isActive);
  if (!target || !target.id) return false;
  return new Promise((resolve) => {
    const body = '{}';
    const req = require('http').request(`${baseUrl}/api/providers/${encodeURIComponent(target.id)}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), Cookie: cookieHeader },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        const text = Buffer.concat(chunks).toString('utf8').slice(0, 300);
        if (!ok) console.error(`[429-OMNIROUTE-REFRESH] ${omniProvider} refresh HTTP ${res.statusCode}: ${text}`);
        else console.error(`[429-OMNIROUTE-REFRESH] ${omniProvider} OAuth token refreshed via OmniRoute API`);
        resolve(ok);
      });
    });
    req.on('error', (err) => {
      console.error(`[429-OMNIROUTE-REFRESH] ${omniProvider} refresh request failed: ${err.message}`);
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

function isOmniRouteCredentialFailure(status, errInfo) {
  if (![400, 401, 403].includes(status)) return false;
  const text = `${errInfo && errInfo.type || ''} ${errInfo && errInfo.message || ''} ${errInfo && errInfo.code || ''}`.toLowerCase();
  return /auth|credential|api[_ -]?key|invalid[_ -]?key|no credentials|forbidden|unauthorized/.test(text);
}

function cloneRetryPayload(payload, provider, model) {
  const retryPayload = JSON.parse(JSON.stringify(payload || {}));
  retryPayload.model = `${provider}/${model}`;
  return retryPayload;
}

async function retryOmniCredentialFailure({
  status,
  errInfo,
  payload,
  swapChain,
  omniProvider,
  swapModel,
  transport,
  upstreamOpts,
  upstreamHeaders,
  projectRoot = PROJECT_ROOT,
}) {
  if (!isOmniRouteCredentialFailure(status, errInfo) || !payload || !Array.isArray(swapChain) || swapChain.length <= 1) return null;
  const failedRoute = `${omniProvider}/${swapModel}`;
  try {
    markRouteCooldown(failedRoute, `credential_failure_${status}`, { ttlMs: 3_600_000, projectRoot });
    emit({ event: 'model_route_quarantine', route: failedRoute, reason: `credential_failure_${status}` });
  } catch (err) {
    console.error(`[hme-proxy] credential-failure route quarantine failed for ${failedRoute}: ${err.message}`);
  }
  const startIdx = swapStore.peek(projectRoot).idx || 0;
  for (let ri = 1; ri < swapChain.length; ri++) {
    const retryIdx = (startIdx + ri) % swapChain.length;
    const candidate = swapChain[retryIdx];
    const provider = omniProviderForConfigProvider(candidate && candidate.provider || '');
    const model = upstreamModelId(candidate);
    const route = `${provider}/${model}`;
    if (route === failedRoute) continue;
    const retryPayload = cloneRetryPayload(payload, provider, model);
    const retryBody = Buffer.from(JSON.stringify(retryPayload), 'utf8');
    const retryHeaders = { ...upstreamHeaders, 'content-length': String(retryBody.length) };
    const retryOpts = { ...upstreamOpts, headers: retryHeaders };
    console.error(`[hme-proxy] OmniRoute credential failover ${ri}/${swapChain.length - 1}: ${failedRoute} -> ${route}`);
    try {
      const retry = await requestBuffer({ transport, opts: retryOpts, body: retryBody });
      if (retry.status >= 200 && retry.status < 300) {
        swapStore.recordSuccess(swapChain, retryIdx, projectRoot);
        emit({ event: 'omniroute_credential_failover', outcome: 'success', prior_route: failedRoute, route });
        console.error(`[hme-proxy] OmniRoute credential failover succeeded: ${route}`);
        return retry;
      }
      const retryErr = detectUpstreamFailure(retry.status, retry.headers, retry.fullBody);
      if (isOmniRouteCredentialFailure(retry.status, retryErr)) {
        try { markRouteCooldown(route, `credential_failure_${retry.status}`, { ttlMs: 3_600_000, projectRoot }); } catch (_e) { /* best effort */ }
      }
      emit({ event: 'omniroute_credential_failover', outcome: 'failed', status: retry.status, prior_route: failedRoute, route });
      console.error(`[hme-proxy] OmniRoute credential failover target failed: ${route} status=${retry.status}`);
    } catch (err) {
      emit({ event: 'omniroute_credential_failover', outcome: 'error', prior_route: failedRoute, route, message: err.message });
      console.error(`[hme-proxy] OmniRoute credential failover error on ${route}: ${err.message}`);
    }
  }
  return null;
}

async function retryStreamTimeout({ outBody, upstreamOpts, upstreamHeaders, transport, sessionForTelemetry, pathLabel, omniProvider, swapModel, resetArgs }) {
  console.error(`omniroute 502 stream_timeout -- same-target retry on ${omniProvider}/${swapModel} before chain advance`);
  const retryHeaders = { ...upstreamHeaders, 'content-length': String(outBody.length) };
  const retryOpts = { ...upstreamOpts, headers: retryHeaders };
  try {
    const retry = await requestBuffer({ transport, opts: retryOpts, body: outBody });
    if (retry.statusCode >= 200 && retry.statusCode < 300) {
      console.error(`stream_timeout retry succeeded (${retry.statusCode}) -- chain advance skipped`);
      recordSuccessAndReset(resetArgs);
      emit({ event: 'upstream_stream_timeout_retry', session: sessionForTelemetry, status: retry.statusCode, path_label: pathLabel, outcome: 'success' });
      return { status: retry.statusCode, headers: retry.headers, fullBody: retry.body };
    }
    console.error(`stream_timeout retry still failing (${retry.statusCode}) -- advancing chain`);
    emit({ event: 'upstream_stream_timeout_retry', session: sessionForTelemetry, status: retry.statusCode, path_label: pathLabel, outcome: 'retry_failed' });
  } catch (retryErr) {
    console.error(`stream_timeout retry threw: ${retryErr.message}`);
    emit({ event: 'upstream_stream_timeout_retry', session: sessionForTelemetry, status: 0, path_label: pathLabel, outcome: `error:${retryErr.message}` });
  }
  return null;
}

async function retry401Bearer({ upstreamHeaders, upstreamOpts, outBody, transport, resetArgs }) {
  console.error('got 401, attempting token refresh + retry before raising upstream alert');
  try {
    const newToken = await refreshOauthToken();
    const retryHeaders = { ...upstreamHeaders, authorization: `Bearer ${newToken}`, 'content-length': String(outBody.length) };
    const retry = await requestBuffer({ transport, opts: { ...upstreamOpts, headers: retryHeaders }, body: outBody });
    console.error(`401-retry response: ${retry.statusCode}`);
    if (retry.statusCode >= 200 && retry.statusCode < 300) {
      recordSuccessAndReset(resetArgs);
      return { status: retry.statusCode, headers: retry.headers, fullBody: retry.body };
    }
  } catch (refreshErr) {
    console.error(`401-refresh failed: ${refreshErr.message}`);
  }
  return null;
}

async function retryAnthropic429({ upstreamHeaders, upstreamOpts, outBody, transport }) {
  console.error(`[429-AUTO-REFRESH] Detected 429 for Anthropic. Attempting OAuth token refresh and retry...`);
  try {
    const newToken = await refreshOauthToken();
    console.error(`[429-AUTO-REFRESH] Successfully refreshed and persisted OAuth credentials. Retrying original request.`);
    const retryHeaders = { ...upstreamHeaders, authorization: `Bearer ${newToken}`, 'content-length': String(outBody.length) };
    const retry = await requestBuffer({ transport, opts: { ...upstreamOpts, headers: retryHeaders }, body: outBody });
    return { status: retry.status, headers: retry.headers, fullBody: retry.body };
  } catch (e) {
    console.error(`[429-AUTO-REFRESH] Refresh and retry failed: ${e.message}`);
    return null;
  }
}

async function retryOmni429({ omniProvider, swapModel, upstreamHeaders, upstreamOpts, outBody, transport, resetArgs }) {
  console.error(`[429-OMNIROUTE-REFRESH] Detected 429 via OmniRoute (${omniProvider}/${swapModel}); refreshing provider OAuth token then retrying...`);
  const refreshed = await refreshOmniRouteProviderOnRateLimit({ omniProvider });
  if (!refreshed) return null;
  try {
    const retryHeaders = { ...upstreamHeaders, 'content-length': String(outBody.length) };
    const retry = await requestBuffer({ transport, opts: { ...upstreamOpts, headers: retryHeaders }, body: outBody });
    if (retry.status >= 200 && retry.status < 300) {
      recordSuccessAndReset(resetArgs);
      return { status: retry.status, headers: retry.headers, fullBody: retry.body };
    }
    console.error(`[429-OMNIROUTE-REFRESH] retry still failed: status=${retry.status}`);
  } catch (e) {
    console.error(`[429-OMNIROUTE-REFRESH] retry threw: ${e.message}`);
  }
  return null;
}

module.exports = {
  refreshOmniRouteProviderOnRateLimit,
  isOmniRouteCredentialFailure,
  retry401Bearer,
  retryAnthropic429,
  retryOmni429,
  retryOmniCredentialFailure,
  retryStreamTimeout,
};
