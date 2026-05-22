'use strict';
const { requireEnv: _hmeRequireEnv } = require('./shared/load_env.js');

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');
const {
  recordUpstreamSuccess,
  recordUpstreamFailure,
  refreshOauthToken,
  omniProviderForConfigProvider,
  upstreamModelId,
  swapStore,
  omniroute,
} = require('./contexts/upstream_dispatch');
const {
  detectUpstreamFailure: _detectUpstreamFailure,
  alertCooldownActive: _alertCooldownActive,
} = require('./failure_classification');
const { recordOmniRouteFailureAdvance } = require('./hme_proxy_codex');
const { markRouteCooldown } = require('./model_route_health');

function recordSuccessAndReset({ getConsecutive429s, setConsecutive429s }) {
  recordUpstreamSuccess();
  if (getConsecutive429s() > 0) {
    console.error(`success -- resetting panic-shrink counter (was ${getConsecutive429s()})`);
    setConsecutive429s(0);
  }
}

const OMNIROUTE_OAUTH_PROVIDERS = new Set(['claude', 'anthropic', 'cx', 'codex']);

async function refreshOmniRouteProviderOnRateLimit({ omniProvider }) {
  if (!OMNIROUTE_OAUTH_PROVIDERS.has(String(omniProvider || '').toLowerCase())) return false;
  const password = process.env.OMNIROUTE_ADMIN_PASSWORD || 'polychron';
  const port = omniroute.port();
  const baseUrl = `http://127.0.0.1:${port}`;
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
  const target = (list && Array.isArray(list.connections) ? list.connections : []).find((c) => c && c.provider === omniProvider && c.authType === 'oauth' && c.isActive);
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
        if (!ok) console.error(`[429-OMNIROUTE-REFRESH] ${omniProvider} refresh HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`);
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
      const retry = await new Promise((resolve, reject) => {
        const req = transport.request(retryOpts, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode || 502, headers: { ...res.headers }, fullBody: Buffer.concat(chunks) }));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.write(retryBody);
        req.end();
      });
      if (retry.status >= 200 && retry.status < 300) {
        swapStore.recordSuccess(swapChain, retryIdx, projectRoot);
        emit({ event: 'omniroute_credential_failover', outcome: 'success', prior_route: failedRoute, route });
        console.error(`[hme-proxy] OmniRoute credential failover succeeded: ${route}`);
        return retry;
      }
      const retryErr = _detectUpstreamFailure(retry.status, retry.headers, retry.fullBody);
      if (isOmniRouteCredentialFailure(retry.status, retryErr)) {
        try { markRouteCooldown(route, `credential_failure_${retry.status}`, { ttlMs: 3_600_000, projectRoot }); } catch (_e) {}
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

async function handleUpstreamFailureOrSuccess({
  status,
  headers,
  fullBody,
  outBody,
  clientReq,
  upstreamHeaders,
  upstreamOpts,
  transport,
  payload,
  isAnthropic,
  passthrough,
  isOmniRouteSwap,
  swapChain,
  odMode,
  omniProvider,
  swapModel,
  isInteractivePath,
  sessionForTelemetry,
  effectiveCompactThreshold,
  getConsecutive429s,
  setConsecutive429s,
  incConsecutive429s,
}) {
  const proxyMutatedBody = isAnthropic && !passthrough;
  if (!proxyMutatedBody) {
    if (status >= 200 && status < 300) recordSuccessAndReset({ getConsecutive429s, setConsecutive429s });
    return { status, headers, fullBody };
  }

  const errInfo = _detectUpstreamFailure(status, headers, fullBody);
  const { classifyFailure } = require('./omni_failure_policy');
  const failureKind = classifyFailure(status, errInfo);
  console.error(`[DEBUG-429] status=${status} type=${errInfo?.type} message=${errInfo?.message} kind=${failureKind}`);
  if (!errInfo) {
    recordSuccessAndReset({ getConsecutive429s, setConsecutive429s });
    return { status, headers, fullBody };
  }

  const provider = isOmniRouteSwap ? 'omniroute' : 'anthropic';
  const pathLabel = isInteractivePath ? 'interactive' : 'sub-pipeline';
  const errMsg = `${provider} ${status} ${errInfo.type || 'error'} [${pathLabel}]: ${errInfo.message || '<no message>'}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotRel = `tmp/claude-${status}-${pathLabel}-payload-${stamp}.json`;
  console.error(`UPSTREAM FAILURE detected: ${errMsg}`);
  const coolingDown = _alertCooldownActive(errInfo.type || `http_${status}`, pathLabel);
  const shouldRetry = headers['x-should-retry'] === 'true';
  const isRateLimit = errInfo.type === 'rate_limit_error';
  // omniroute_client classifies OmniRoute-transient failures in one place.
  const isStreamTimeout502 = isOmniRouteSwap && omniroute.isTransientStreamTimeout({ status, errInfo, body: fullBody });
  if (isStreamTimeout502 && payload && Array.isArray(payload.messages)) {
    try {
      console.error(`omniroute 502 stream_timeout -- same-target retry on ${omniProvider}/${swapModel} before chain advance`);
      const retryHeaders = { ...upstreamHeaders, 'content-length': String(outBody.length) };
      const retryOpts = { ...upstreamOpts, headers: retryHeaders };
      const retry = await new Promise((resolve, reject) => {
        const req = transport.request(retryOpts, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ statusCode: res.statusCode || 502, headers: { ...res.headers }, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.write(outBody);
        req.end();
      });
      if (retry.statusCode >= 200 && retry.statusCode < 300) {
        console.error(`stream_timeout retry succeeded (${retry.statusCode}) -- chain advance skipped`);
        recordSuccessAndReset({ getConsecutive429s, setConsecutive429s });
        emit({ event: 'upstream_stream_timeout_retry', session: sessionForTelemetry, status: retry.statusCode, path_label: pathLabel, outcome: 'success' });
        return { status: retry.statusCode, headers: retry.headers, fullBody: retry.body };
      }
      console.error(`stream_timeout retry still failing (${retry.statusCode}) -- advancing chain`);
      emit({ event: 'upstream_stream_timeout_retry', session: sessionForTelemetry, status: retry.statusCode, path_label: pathLabel, outcome: 'retry_failed' });
    } catch (retryErr) {
      console.error(`stream_timeout retry threw: ${retryErr.message}`);
      emit({ event: 'upstream_stream_timeout_retry', session: sessionForTelemetry, status: 0, path_label: pathLabel, outcome: `error:${retryErr.message}` });
    }
  }

  const isBearerAuth = typeof upstreamHeaders['authorization'] === 'string'
    && upstreamHeaders['authorization'].startsWith('Bearer ');
  if (status === 401 && isBearerAuth && payload && Array.isArray(payload.messages)) {
    try {
      console.error('got 401, attempting token refresh + retry before raising upstream alert');
      const newToken = await refreshOauthToken();
      const retryHeaders = { ...upstreamHeaders, authorization: `Bearer ${newToken}` };
      retryHeaders['content-length'] = String(outBody.length);
      const retryOpts = { ...upstreamOpts, headers: retryHeaders };
      const retry = await new Promise((resolve, reject) => {
        const req = transport.request(retryOpts, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ statusCode: res.statusCode || 502, headers: { ...res.headers }, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.write(outBody);
        req.end();
      });
      console.error(`401-retry response: ${retry.statusCode}`);
      if (retry.statusCode >= 200 && retry.statusCode < 300) {
        recordSuccessAndReset({ getConsecutive429s, setConsecutive429s });
        return { status: retry.statusCode, headers: retry.headers, fullBody: retry.body };
      }
    } catch (refreshErr) {
      console.error(`401-refresh failed: ${refreshErr.message}`);
    }
  }

  const credentialFailover = await retryOmniCredentialFailure({
    status,
    errInfo,
    payload,
    swapChain,
    omniProvider,
    swapModel,
    transport,
    upstreamOpts,
    upstreamHeaders,
    projectRoot: PROJECT_ROOT,
  });
  if (credentialFailover) {
    recordSuccessAndReset({ getConsecutive429s, setConsecutive429s });
    return { status: credentialFailover.status, headers: credentialFailover.headers, fullBody: credentialFailover.fullBody };
  }

  recordOmniRouteFailureAdvance({
    isOmniRouteSwap,
    swapChain,
    odMode,
    omniProvider,
    swapModel,
    status,
    isRateLimit,
    projectRoot: PROJECT_ROOT,
  });

  if (isRateLimit && !shouldRetry) {
    incConsecutive429s();
    if (provider === 'anthropic') {
      console.error(`[429-AUTO-REFRESH] Detected 429 for Anthropic. Attempting OAuth token refresh and retry...`);
      try {
        const newToken = await refreshOauthToken();
        console.error(`[429-AUTO-REFRESH] Successfully refreshed and persisted OAuth credentials. Retrying original request.`);

        // Retry with the new token (same as 401 handler pattern)
        const retryHeaders = { ...upstreamHeaders, authorization: `Bearer ${newToken}` };
        retryHeaders['content-length'] = String(outBody.length);
        const retryOpts = { ...upstreamOpts, headers: retryHeaders };
        const retry = await new Promise((resolve, reject) => {
          const req = transport.request(retryOpts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode || 502, headers: { ...res.headers }, body: Buffer.concat(chunks) }));
            res.on('error', reject);
          });
          req.on('error', reject);
          req.write(outBody);
          req.end();
        });

        return { status: retry.status, headers: retry.headers, fullBody: retry.body };
      } catch (e) {
        console.error(`[429-AUTO-REFRESH] Refresh and retry failed: ${e.message}`);
      }
    } else if (isOmniRouteSwap) {
      console.error(`[429-OMNIROUTE-REFRESH] Detected 429 via OmniRoute (${omniProvider}/${swapModel}); refreshing provider OAuth token then retrying...`);
      const refreshed = await refreshOmniRouteProviderOnRateLimit({ omniProvider });
      if (refreshed) {
        try {
          const retryHeaders = { ...upstreamHeaders, 'content-length': String(outBody.length) };
          const retryOpts = { ...upstreamOpts, headers: retryHeaders };
          const retry = await new Promise((resolve, reject) => {
            const req = transport.request(retryOpts, (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode || 502, headers: { ...res.headers }, body: Buffer.concat(chunks) }));
              res.on('error', reject);
            });
            req.on('error', reject);
            req.write(outBody);
            req.end();
          });
          if (retry.status >= 200 && retry.status < 300) {
            recordSuccessAndReset({ getConsecutive429s, setConsecutive429s });
            return { status: retry.status, headers: retry.headers, fullBody: retry.body };
          }
          console.error(`[429-OMNIROUTE-REFRESH] retry still failed: status=${retry.status}`);
        } catch (e) {
          console.error(`[429-OMNIROUTE-REFRESH] retry threw: ${e.message}`);
        }
      }
    }
    const nextPlan = effectiveCompactThreshold();
    const nextThreshold = typeof nextPlan === 'object' ? nextPlan.threshold : nextPlan;
    console.error(`rate_limit_error (ITPM-exhaustion) -- panic-shrink counter=${getConsecutive429s()}, next threshold=${nextThreshold}B`);
  } else if (isRateLimit && shouldRetry) {
    console.error('rate_limit_error (Cloudflare per-IP throttle) -- skip panic-shrink (size irrelevant)');
  }

  if (isInteractivePath && !coolingDown && process.env.OVERDRIVE_MODE !== '1') {
    recordUpstreamFailure(errMsg);
  } else if (isInteractivePath) {
    console.error(`escape hatch SUPPRESSED (OVERDRIVE_MODE=${_hmeRequireEnv('OVERDRIVE_MODE')}, _isOmniRouteSwap=${isOmniRouteSwap}) -- passthrough blocked`);
  } else if (!isInteractivePath) {
    console.error('sub-pipeline failure -- NOT tripping escape hatch (interactive path unaffected)');
  }

  try {
    const outFile = path.join(PROJECT_ROOT, snapshotRel);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, outBody);
    fs.writeFileSync(outFile.replace('.json', '.response'), fullBody);
    fs.writeFileSync(outFile.replace('.json', '.headers.json'), JSON.stringify(headers, null, 2));
    try {
      fs.writeFileSync(outFile.replace('.json', '.request-headers.json'), JSON.stringify({
        method: clientReq.method,
        url: clientReq.url,
        incoming_headers: clientReq.headers,
        outgoing_headers: upstreamHeaders,
      }, null, 2));
    } catch (_e) { /* best-effort */ }
    console.error(`payload snapshotted to ${outFile}`);
    const suppressLifesaver = coolingDown || pathLabel === 'sub-pipeline';
    if (!suppressLifesaver) {
      const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
      fs.appendFileSync(errLog,
        `[${stamp}] UPSTREAM_${status}_${pathLabel.toUpperCase()}: ${errMsg} (request_id=${errInfo.requestId || '?'}, snapshot=${snapshotRel})\n`);
    }
  } catch (err) {
    console.error(`snapshot/lifesaver write failed: ${err.message}`);
  }
  emit({ event: 'upstream_error', session: sessionForTelemetry, status, type: errInfo.type, message: errInfo.message, path_label: pathLabel });

  return { status, headers, fullBody };
}

module.exports = { handleUpstreamFailureOrSuccess, recordSuccessAndReset };
