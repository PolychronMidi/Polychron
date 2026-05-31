'use strict';
const http = require('http');
const https = require('https');

const { sessionKey } = require('./shared');
const {
  resolveUpstream, recordUpstreamFailure, isPassthroughMode,
} = require('./contexts/upstream_dispatch');
const { applyOverdriveRoute } = require('./contexts/upstream_dispatch');
const { handleLegacySwapResponse } = require('./legacy_swap_response');
function handleAnthropicResponseComplete(...args) {
  // LAZY: avoids loading response/failure-policy stack while upstream_dispatch
  // is still initializing hme_proxy_claude.
  return require('./hme_proxy_anthropic_response').handleAnthropicResponseComplete(...args);
}
const middleware = require('./contexts/request_mutation').middleware;
function mutateClaudeRequest(...args) {
  // LAZY: breaks import cycle hme_proxy_claude -> hme_proxy_request_mutation
  //       -> overdrive_route -> hme_proxy_claude.
  return require('./contexts/request_mutation').mutateClaudeRequest(...args);
}
const { createProxyRouteDispatcher } = require('./contexts/lifecycle_bridge');
function lifecycleBridge() {
  const bridge = require('./contexts/lifecycle_bridge').lifecycleBridge;
  if (!bridge
      || typeof bridge.lifecycleInactive !== 'function'
      || typeof bridge.runInlineFallback !== 'function') {
    throw new Error('lifecycle_bridge import resolved without required exports'
      + ' (likely a re-introduced circular dependency); refusing lifecycle route');
  }
  return bridge;
}
const {
  handleMidResponseError,
  handleConnectionError,
} = require('./contexts/failure_policy/hme_proxy_connection_errors');
const {
  _stripHmePrefixOutgoing,
  _stripStaleToolResults,
  _stripClaudeIdentity,
  _sanitizePayload,
  _injectHmeTools,
  _injectStopReminderSystem,
  _stopGateHealth,
} = require('./hme_proxy_core');
const { createFpGateScanner } = require('./hme_proxy_fp_gate');
const { prepareUpstreamHeaders } = require('./hme_proxy_headers');
const { routeOpenAICompatibleThroughHme } = require('./openai_compatible_ingress');
const { evaluateOutbound } = require('./outbound_context_gate');
const {
  captureNoopReminderLeak,
  maybeBlockEarlyClaudeRequest,
  maybeBlockLateClaudeProbeRequest,
} = require('./hme_proxy_claude_guards');

function createClaudeHandler(deps) {
  const {
    PORT, PROXY_VERSION, PROXY_GIT_SHA, PROXY_RUNTIME_FINGERPRINT, PROXY_STARTED_AT, routeMetrics: _routeMetrics,
    recordProxyRoute,
    effectiveCompactThreshold: _effectiveCompactThreshold,
    shrinkForPassthrough: _shrinkForPassthrough,
    shrinkForContext: _shrinkForOmniContext,
    injectContextHeader: _injectContextHeader,
    acquireOpusSlot: _acquireOpusSlot,
    anthropicTextSseBuffer: _anthropicTextSseBuffer,
    getConsecutive429s,
    setConsecutive429s,
    incConsecutive429s,
    getLastInputTokensRemaining,
    setLastInputTokensRemaining,
    getLastInputTokensLimit,
    setLastInputTokensLimit,
    setLastPayloadBytes,
    estimatedContextTokens,
    omniContextThresholdBytes,
    loadedMiddleware = [],
  } = deps;
  const dispatchProxyRoute = createProxyRouteDispatcher({
    PORT,
    PROXY_VERSION,
    PROXY_GIT_SHA,
    PROXY_RUNTIME_FINGERPRINT,
    PROXY_STARTED_AT,
    routeMetrics: _routeMetrics,
    stopGateHealth: _stopGateHealth,
    loadedMiddleware,
    handleLifecycleRoute: (req, res) => lifecycleBridge().handleLifecycleRoute(req, res),
  });

  function handleRequest(clientReq, clientRes) {
    if (dispatchProxyRoute(clientReq, clientRes)) return;
    const chunks = [];
    clientReq.on('data', (c) => chunks.push(c));
    clientReq.on('end', async () => {
      const bodyBuf = Buffer.concat(chunks);
      let payload = null;
      if (bodyBuf.length > 0) {
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch (_err) { /* pass through */ }
      }

      if (maybeBlockEarlyClaudeRequest({ clientReq, clientRes, payload })) return;
      captureNoopReminderLeak({ clientReq, payload });
      if (maybeBlockLateClaudeProbeRequest({ clientReq, clientRes, payload })) return;

      let outBody = bodyBuf;
      let injected = false;
      if (routeOpenAICompatibleThroughHme(clientReq, payload, { shrinkForPassthrough: _shrinkForPassthrough })) {
        outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        injected = true;
      }

      let _legacySwapWasStreaming = false;
      let _isLegacySwap = false;
      let _isOmniRouteSwap = false;
      let _swapChain = [];
      let _swapModel = 'deepseek-v4-pro';
      let _omniProvider = 'opencode-go';

      const _gatedStripStaleToolResults = (payloadArg) => {
        if (typeof _effectiveCompactThreshold === 'function') {
          try {
            const plan = _effectiveCompactThreshold(payloadArg);
            if (!plan || (plan.maxTier || 0) <= 0) return 0;
          } catch (_e) { /* silent-ok: budget-resolve failure must not strip */ return 0; }
        }
        return _stripStaleToolResults(payloadArg);
      };
      const overdriveRoute = applyOverdriveRoute({
        payload,
        clientReq,
        clientRes,
        outBody,
        stripStaleToolResults: _gatedStripStaleToolResults,
        stripClaudeIdentity: _stripClaudeIdentity,
        shrinkForContext: _shrinkForOmniContext,
      });
      if (overdriveRoute.ended) return;
      if (overdriveRoute.applied) {
        outBody = overdriveRoute.outBody;
        injected = true;
        _legacySwapWasStreaming = overdriveRoute.wasStreaming;
        _isLegacySwap = overdriveRoute.isLegacySwap;
        _isOmniRouteSwap = overdriveRoute.isOmniRoute;
        _swapChain = overdriveRoute.swapChain;
        _swapModel = overdriveRoute.swapModel;
        _omniProvider = overdriveRoute.omniProvider;
        if (overdriveRoute.lastPayloadBytes) setLastPayloadBytes(overdriveRoute.lastPayloadBytes);
      }

      const upstream = resolveUpstream(clientReq);
      recordProxyRoute(_isOmniRouteSwap ? 'omniroute' : (_isLegacySwap ? 'legacy_swap' : (isPassthroughMode() ? 'passthrough' : 'direct')), payload && payload.model);
      const isAnthropic = upstream.provider === 'anthropic' || _isOmniRouteSwap;

      // Discriminator: only INTERACTIVE-path 429s trip the global escape
      // hatch. OVERDRIVE/loopback callers self-handle via their own circuit
      const _isInteractivePath = (upstream.provider === 'anthropic' || _isOmniRouteSwap)
        && (typeof clientReq.headers.authorization === 'string'
            || typeof clientReq.headers['x-api-key'] === 'string'
            || _isOmniRouteSwap);

      // Hoisted session key: upstream response/error callbacks run outside
      // the `if (payload && messages && !_passthrough)` block.
      const _sessionForTelemetry = (payload ? sessionKey(payload) : 'no-payload');

      const mutation = await mutateClaudeRequest({
        payload,
        outBody,
        injected,
        upstream,
        clientReq,
        isAnthropic,
        isInteractivePath: _isInteractivePath,
        shrinkForPassthrough: _shrinkForPassthrough,
        stripHmePrefixOutgoing: _stripHmePrefixOutgoing,
        injectHmeTools: _injectHmeTools,
        sanitizePayload: _sanitizePayload,
        injectStopReminderSystem: _injectStopReminderSystem,
        lifecycleInactive: deps.lifecycleInactive || ((event) => lifecycleBridge().lifecycleInactive(event)),
        runInlineFallback: deps.runInlineFallback || ((event, stdinJson) => lifecycleBridge().runInlineFallback(event, stdinJson)),
        middleware,
      });
      outBody = mutation.outBody;
      injected = mutation.injected;
      const _passthrough = mutation.passthrough;

      // Final outbound context-budget gate: the single invariant that no later
      // mutation can bypass -- never ship a request over the resolved route's
      if (isAnthropic && _isInteractivePath && payload && Array.isArray(payload.messages)) {
        const gateModel = _isOmniRouteSwap ? _swapModel : (payload.model || '');
        const verdict = evaluateOutbound({ payload, modelId: gateModel, swapChain: _swapChain });
        if (verdict.action === 'compacted') {
          outBody = Buffer.from(JSON.stringify(payload), 'utf8');
          emit({ event: 'outbound_gate_compacted', session: _sessionForTelemetry, model: gateModel, tokens: verdict.tokens, budget: verdict.budget });
        } else if (verdict.action === 'rerouted') {
          // OmniRoute swap targets share one upstream host; reroute = rewrite the
          // model string + re-serialize. payload.model is `provider/model`.
          const newModel = verdict.reroute.api_model || verdict.reroute.id;
          if (_isOmniRouteSwap && typeof payload.model === 'string' && payload.model.includes('/')) {
            payload.model = `${payload.model.split('/')[0]}/${newModel}`;
          } else {
            payload.model = newModel;
          }
          _swapModel = newModel;
          outBody = Buffer.from(JSON.stringify(payload), 'utf8');
          emit({ event: 'outbound_gate_rerouted', session: _sessionForTelemetry, from: gateModel, to: newModel, tokens: verdict.tokens });
        } else if (!verdict.ok) {
          // Local preflight refusal -- NOT an upstream failure, so do not touch
          // recordUpstreamFailure (that arms the emergency circuit breaker on
          const reason = `UPSTREAM_PREFLIGHT_OVER_WINDOW: est ${verdict.tokens} input tokens > route budget ${verdict.budget} for ${verdict.model}; compaction and reroute exhausted. Refusing to ship a known-over-window request.`;
          try {
            const { PROJECT_ROOT } = require('./shared');
            require('fs').appendFileSync(require('path').join(PROJECT_ROOT, 'log', 'hme-errors.log'),
              `[${new Date().toISOString()}] [outbound-gate] ${reason}\n`);
          } catch (_e) { /* silent-ok: error-log surfacing is best-effort */ }
          emit({ event: 'outbound_gate_over_window', session: _sessionForTelemetry, model: verdict.model, tokens: verdict.tokens, budget: verdict.budget });
          clientRes.writeHead(413, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: reason } }));
          return;
        }
      }

      const upstreamHeaders = prepareUpstreamHeaders({
        clientReq,
        upstream,
        outBody,
        isAnthropic,
        isOmniRouteSwap: _isOmniRouteSwap,
      });

      const upstreamPath = (upstream.basePath || '') + clientReq.url;
      const upstreamOpts = {
        hostname: upstream.host,
        port: upstream.port,
        path: upstreamPath,
        method: clientReq.method,
        headers: upstreamHeaders,
      };

      const _isOpusReq = isAnthropic && _isInteractivePath
        && payload && typeof payload.model === 'string'
        && /opus/i.test(payload.model);
      let _releaseOpusSlot = () => {};
      if (_isOpusReq) {
        _releaseOpusSlot = await _acquireOpusSlot();
      }

      const transport = upstream.tls ? https : http;
      let _connAttempt = 0;
      let upstreamReq;

      function _spawnUpstream() {
        _connAttempt++;
        upstreamReq = transport.request(upstreamOpts, (upstreamRes) => {
            if (_isLegacySwap) {
            handleLegacySwapResponse({
              upstreamRes,
              clientRes,
              wasStreaming: _legacySwapWasStreaming,
              releaseOpusSlot: _releaseOpusSlot,
              model: _swapModel,
            });
            return;
          }

          if (!isAnthropic) {
            clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
            upstreamRes.pipe(clientRes);
            upstreamRes.on('end', _releaseOpusSlot);
            return;
          }

        // Anthropic path: buffer the entire response so we can scan for HME_*
        // tool_uses. If none present, forward buffer + apply SSE transforms
        const upstreamResChunks = [];

        const scanFpGateChunk = createFpGateScanner({
          payload,
          chunks: upstreamResChunks,
          destroyUpstream: () => upstreamReq.destroy(),
        });
        upstreamRes.on('data', (c) => {
          upstreamResChunks.push(c);
          scanFpGateChunk(c);
        });
        upstreamRes.on('end', async () => {
          try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
          try {
            await handleAnthropicResponseComplete({
              chunks: upstreamResChunks,
              upstreamRes,
              clientRes,
              clientReq,
              payload,
              headers: upstreamRes.headers,
              bodyBuf,
              outBody,
              upstream,
              upstreamPath,
              upstreamHeaders,
              upstreamOpts,
              transport,
              isAnthropic,
              passthrough: _passthrough,
              isOmniRouteSwap: _isOmniRouteSwap,
              swapChain: _swapChain,
              odMode: overdriveRoute.mode,
              omniProvider: _omniProvider,
              swapModel: _swapModel,
              isInteractivePath: _isInteractivePath,
              sessionForTelemetry: _sessionForTelemetry,
              effectiveCompactThreshold: _effectiveCompactThreshold,
              getConsecutive429s,
              setConsecutive429s,
              incConsecutive429s,
              getLastInputTokensRemaining,
              setLastInputTokensRemaining,
              getLastInputTokensLimit,
              setLastInputTokensLimit,
              estimatedContextTokens,
              omniContextThresholdBytes,
              injectContextHeader: _injectContextHeader,
              anthropicTextSseBuffer: _anthropicTextSseBuffer,
              lifecycleInactive: deps.lifecycleInactive || ((event) => lifecycleBridge().lifecycleInactive(event)),
              runInlineFallback: deps.runInlineFallback || ((event, stdinJson) => lifecycleBridge().runInlineFallback(event, stdinJson)),
              skipStopFallback: deps.skipStopFallback === true,
            });
          } catch (fatalErr) {
            console.error(`[hme-proxy] FATAL in handleAnthropicResponseComplete: ${fatalErr.message} ${fatalErr.stack}`);
            try { require('./middleware/_middleware_throw_lifesaver').recordProxyFailure(require('./shared').PROJECT_ROOT, 'response-complete-handler', fatalErr); } catch (_e) { /* never let alerting throw */ }
            if (!clientRes.headersSent) {
              clientRes.writeHead(502, { 'Content-Type': 'application/json' });
              clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_internal', message: fatalErr.message } }));
            } else {
              try { clientRes.end(); } catch (_e) { /* ignore */ }
            }
          }
        });
        upstreamRes.on('error', (err) => handleMidResponseError({
          err,
          clientRes,
          isInteractivePath: _isInteractivePath,
          releaseOpusSlot: _releaseOpusSlot,
          recordFailure: recordUpstreamFailure,
          model: payload && payload.model || _swapModel || 'claude-proxy',
        }));
      });

      const isStreaming = payload && payload.stream === true;
      // 30-min upstream timeout: covers worst-case multi-MB local subprocess
      // turnaround. The subprocess timeout is the tighter bound; proxy is
      const UPSTREAM_TIMEOUT_MS = 1_800_000;
      upstreamReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
        console.error(`upstream timeout (${isStreaming ? 'streaming' : 'sync'})`);
        try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
        upstreamReq.destroy(new Error('upstream timeout'));
      });

      upstreamReq.on('error', (err) => handleConnectionError({
        err,
        clientRes,
        isInteractivePath: _isInteractivePath,
        connAttempt: _connAttempt,
        outBody,
        releaseOpusSlot: _releaseOpusSlot,
        spawnUpstream: _spawnUpstream,
        recordFailure: recordUpstreamFailure,
      }));

      if (outBody.length > 0) upstreamReq.write(outBody);
      upstreamReq.end();
      } // _spawnUpstream
      _spawnUpstream();
    });

    clientReq.on('error', (err) => {
      console.error('client error:', err.message);
      try { clientRes.end(); } catch (_e) { /* ignore */ }
    });
  }

  return handleRequest;
}

module.exports = { createClaudeHandler, routeOpenAICompatibleThroughHme };
