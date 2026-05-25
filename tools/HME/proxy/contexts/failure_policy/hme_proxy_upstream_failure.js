'use strict';

const { PROJECT_ROOT } = require('../../shared');
const omniroute = require('../upstream_dispatch').omnirouteClient;
const {
  detectUpstreamFailure: _detectUpstreamFailure,
  alertCooldownActive: _alertCooldownActive,
} = require('./failure_classification');
const { recordOmniRouteFailureAdvance } = require('./hme_proxy_codex');
const { classifyFailure } = require('./omni_failure_policy');
const { recordSuccessAndReset } = require('./upstream_failure_state');
const {
  retry401Bearer,
  retryAnthropic429,
  retryOmni429,
  retryOmniCredentialFailure,
  retryStreamTimeout,
} = require('./upstream_failure_retry');
const { recordFailureSideEffects } = require('./upstream_failure_side_effects');

function failureDetails({ status, errInfo, provider, isInteractivePath }) {
  const pathLabel = isInteractivePath ? 'interactive' : 'sub-pipeline';
  const errMsg = `${provider} ${status} ${errInfo.type || 'error'} [${pathLabel}]: ${errInfo.message || '<no message>'}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotRel = `tmp/claude-${status}-${pathLabel}-payload-${stamp}.json`;
  return { pathLabel, errMsg, stamp, snapshotRel };
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
  const resetArgs = { getConsecutive429s, setConsecutive429s };
  const proxyMutatedBody = isAnthropic && !passthrough;
  if (!proxyMutatedBody) {
    if (status >= 200 && status < 300) recordSuccessAndReset(resetArgs);
    return { status, headers, fullBody };
  }

  const errInfo = _detectUpstreamFailure(status, headers, fullBody);
  const failureKind = classifyFailure(status, errInfo);
  console.error(`[DEBUG-429] status=${status} type=${errInfo?.type} message=${errInfo?.message} kind=${failureKind}`);
  if (!errInfo) {
    recordSuccessAndReset(resetArgs);
    return { status, headers, fullBody };
  }

  const provider = isOmniRouteSwap ? 'omniroute' : 'anthropic';
  const details = failureDetails({ status, errInfo, provider, isInteractivePath });
  const { pathLabel, errMsg, stamp, snapshotRel } = details;
  console.error(`UPSTREAM FAILURE detected: ${errMsg}`);
  const coolingDown = _alertCooldownActive(errInfo.type || `http_${status}`, pathLabel);
  const shouldRetry = headers['x-should-retry'] === 'true';
  const isRateLimit = errInfo.type === 'rate_limit_error';
  const isStreamTimeout502 = isOmniRouteSwap
    && omniroute.isTransientStreamTimeout({ status, errInfo, body: fullBody });

  if (isStreamTimeout502 && payload && Array.isArray(payload.messages)) {
    const streamRetry = await retryStreamTimeout({
      outBody,
      upstreamOpts,
      upstreamHeaders,
      transport,
      sessionForTelemetry,
      pathLabel,
      omniProvider,
      swapModel,
      resetArgs,
    });
    if (streamRetry) return streamRetry;
  }

  const isBearerAuth = typeof upstreamHeaders.authorization === 'string'
    && upstreamHeaders.authorization.startsWith('Bearer ');
  if (status === 401 && isBearerAuth && payload && Array.isArray(payload.messages)) {
    const authRetry = await retry401Bearer({ upstreamHeaders, upstreamOpts, outBody, transport, resetArgs });
    if (authRetry) return authRetry;
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
    recordSuccessAndReset(resetArgs);
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
      const retry = await retryAnthropic429({ upstreamHeaders, upstreamOpts, outBody, transport });
      if (retry) return retry;
    } else if (isOmniRouteSwap) {
      const retry = await retryOmni429({
        omniProvider,
        swapModel,
        upstreamHeaders,
        upstreamOpts,
        outBody,
        transport,
        resetArgs,
      });
      if (retry) return retry;
    }
    const nextPlan = effectiveCompactThreshold();
    const nextThreshold = typeof nextPlan === 'object' ? nextPlan.threshold : nextPlan;
    console.error(`rate_limit_error (ITPM-exhaustion) -- panic-shrink counter=${getConsecutive429s()}, next threshold=${nextThreshold}B`);
  } else if (isRateLimit && shouldRetry) {
    console.error('rate_limit_error (Cloudflare per-IP throttle) -- skip panic-shrink (size irrelevant)');
  }

  recordFailureSideEffects({
    status,
    headers,
    fullBody,
    outBody,
    clientReq,
    upstreamHeaders,
    errInfo,
    errMsg,
    stamp,
    snapshotRel,
    pathLabel,
    coolingDown,
    isInteractivePath,
    isOmniRouteSwap,
    sessionForTelemetry,
    projectRoot: PROJECT_ROOT,
  });

  return { status, headers, fullBody };
}

module.exports = { handleUpstreamFailureOrSuccess, recordSuccessAndReset };
