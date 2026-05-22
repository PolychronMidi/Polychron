'use strict';
const { requireEnv: _hmeRequireEnv } = require('./shared/load_env.js');

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');
const { recordUpstreamSuccess, recordUpstreamFailure, refreshOauthToken } = require('./upstream');
const {
  detectUpstreamFailure: _detectUpstreamFailure,
  alertCooldownActive: _alertCooldownActive,
} = require('./failure_classification');
const { recordOmniRouteFailureAdvance } = require('./hme_proxy_codex');
const omniroute = require('./omniroute_client');

function recordSuccessAndReset({ getConsecutive429s, setConsecutive429s }) {
  recordUpstreamSuccess();
  if (getConsecutive429s() > 0) {
    console.error(`success -- resetting panic-shrink counter (was ${getConsecutive429s()})`);
    setConsecutive429s(0);
  }
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
  console.error(`[DEBUG-429] status=${status} type=${errInfo?.type} message=${errInfo?.message}`);
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
