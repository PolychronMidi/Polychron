'use strict';

const http = require('http');
const https = require('https');

const { sessionKey, emit } = require('./shared');
const {
  resolveUpstream, recordUpstreamFailure, isPassthroughMode,
} = require('./upstream');
const { applyOverdriveRoute } = require('./overdrive_route');
const { handleLegacySwapResponse } = require('./legacy_swap_response');
const middleware = require('./middleware/index');
const hmeDispatcher = require('./hme_dispatcher');
const { createProxyRouteDispatcher } = require('./hme_proxy_routes');
const {
  _stripHmePrefixOutgoing,
  _stripStaleToolResults,
  _stripClaudeIdentity,
  _sanitizePayload,
  _injectHmeTools,
  _injectStopReminderSystem,
  _stopGateHealth,
} = require('./hme_proxy_core');
const { traceAnthropicResponse } = require('./hme_proxy_response_trace');
const { sendFinalResponse, maybeRunStopFallback } = require('./hme_proxy_response_send');
const { createFpGateScanner } = require('./hme_proxy_fp_gate');
const { handleUpstreamFailureOrSuccess } = require('./hme_proxy_upstream_failure');
const { prepareUpstreamHeaders } = require('./hme_proxy_headers');
const { mutateClaudeRequest } = require('./hme_proxy_request_mutation');
const { handleMidResponseError, handleConnectionError } = require('./hme_proxy_connection_errors');

function lifecycleBridge() {
  return require('./lifecycle_bridge');
}

function createClaudeHandler(deps) {
  const {
    PORT, PROXY_VERSION, PROXY_GIT_SHA, PROXY_STARTED_AT, routeMetrics: _routeMetrics,
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
  } = deps;
  const dispatchProxyRoute = createProxyRouteDispatcher({
    PORT,
    PROXY_VERSION,
    PROXY_GIT_SHA,
    PROXY_STARTED_AT,
    routeMetrics: _routeMetrics,
    stopGateHealth: _stopGateHealth,
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

      let outBody = bodyBuf;
      let injected = false;

      let _legacySwapWasStreaming = false;
      let _isLegacySwap = false;
      let _isOmniRouteSwap = false;
      let _swapChain = [];
      let _swapModel = 'deepseek-v4-pro';
      let _omniProvider = 'opencode-go';

      const _odMode = process.env.OVERDRIVE_MODE || '0';

      const overdriveRoute = applyOverdriveRoute({
        payload,
        clientReq,
        clientRes,
        outBody,
        stripStaleToolResults: _stripStaleToolResults,
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
      // breaker; tripping global on them breaks Claude Code's UI.
      const _isInteractivePath = (upstream.provider === 'anthropic' || _isOmniRouteSwap)
        && (typeof clientReq.headers['authorization'] === 'string'
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
        lifecycleInactive: (event) => lifecycleBridge().lifecycleInactive(event),
        runInlineFallback: (event, stdinJson) => lifecycleBridge().runInlineFallback(event, stdinJson),
        middleware,
      });
      outBody = mutation.outBody;
      injected = mutation.injected;
      const _passthrough = mutation.passthrough;

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
        // (Bash run_in_background rewrite). If HME_* present, run the
        // continuation loop until a final HME-free response, then forward it.
        const chunks = [];

        const scanFpGateChunk = createFpGateScanner({
          payload,
          chunks,
          destroyUpstream: () => upstreamReq.destroy(),
        });
        upstreamRes.on('data', (c) => {
          chunks.push(c);
          scanFpGateChunk(c);
        });
        upstreamRes.on('end', async () => {
          try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
          let fullBody = Buffer.concat(chunks);
          let status = upstreamRes.statusCode || 502;
          let headers = { ...upstreamRes.headers };
          // Context monitoring: inject synthetic token-remaining header so
          // Claude Code's native /compact fires before hitting model context limits.
          if (_isOmniRouteSwap) _injectContextHeader(headers, _swapModel);
          // Capture Anthropic's rate-limit telemetry so the next request's
          // _shrinkForPassthrough can size the byte budget dynamically
          // instead of using the static 400KB ceiling. Header name per
          // https://platform.claude.com/docs/en/api/rate-limits.
          const _hdrTokRemaining = headers['anthropic-ratelimit-input-tokens-remaining'];
          const _hdrTokLimit = headers['anthropic-ratelimit-input-tokens-limit'];
          const _hdrTokReset = headers['anthropic-ratelimit-input-tokens-reset'];
          if (_hdrTokRemaining != null) {
            const n = parseInt(_hdrTokRemaining, 10);
            if (Number.isFinite(n) && n >= 0) setLastInputTokensRemaining(n);
          }
          if (_hdrTokLimit != null) {
            const n = parseInt(_hdrTokLimit, 10);
            if (Number.isFinite(n) && n > 0) setLastInputTokensLimit(n);
          }
          // On any 4xx, dump the rate-limit telemetry so we can SEE what
          // Anthropic told us (instead of the unhelpful "Error" body).
          if (status >= 400 && status < 500 && (_hdrTokLimit || _hdrTokRemaining || _hdrTokReset || headers['retry-after'])) {
            console.error(`rate-limit headers: limit=${_hdrTokLimit||'?'} remaining=${_hdrTokRemaining||'?'} reset=${_hdrTokReset||'?'} retry-after=${headers['retry-after']||'?'}`);
          }

          const failureResult = await handleUpstreamFailureOrSuccess({
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
            passthrough: _passthrough,
            isOmniRouteSwap: _isOmniRouteSwap,
            swapChain: _swapChain,
            odMode: _odMode,
            omniProvider: _omniProvider,
            swapModel: _swapModel,
            isInteractivePath: _isInteractivePath,
            sessionForTelemetry: _sessionForTelemetry,
            effectiveCompactThreshold: _effectiveCompactThreshold,
            getConsecutive429s,
            setConsecutive429s,
            incConsecutive429s,
          });
          status = failureResult.status;
          headers = failureResult.headers;
          fullBody = failureResult.fullBody;


          let final = null;
          if (status >= 200 && status < 300 && payload) {
            try {
              final = await hmeDispatcher.maybeHandleHme(
                fullBody, headers, status, payload,
                { host: upstream.host, port: upstream.port, tls: upstream.tls,
                  path: upstreamPath, method: 'POST', headers: upstreamHeaders },
                (headers['content-type'] || '').toLowerCase().includes('text/event-stream'),
              );
            } catch (err) {
              console.error('HME continuation failed:', err.message);
            }
          }

          let outStatus = status;
          let outHeaders = headers;
          let outBuf = fullBody;
          if (_isOmniRouteSwap && status >= 200 && status < 300
              && (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream')) {
            const _s = outBuf.toString('utf8');
            if (!_s.includes('event: message_start') && /input exceeds the context window/i.test(_s)) {
              const _msg = 'Context window exceeded upstream before Claude Code could compact. Please send /compact or start a fresh turn; hme-proxy will preflight-shrink future near-limit OmniRoute requests.';
              console.error(`[hme-proxy] OmniRoute context-window SSE normalized to Anthropic text event (${outBuf.length}B error body)`);
              outBuf = _anthropicTextSseBuffer(_swapModel, _msg);
              outHeaders = { ...outHeaders, 'content-type': 'text/event-stream; charset=utf-8' };
              delete outHeaders['content-length'];
            }
          }
          if (final) {
            outStatus = final.finalStatus;
            outHeaders = { ...final.finalHeaders };
            outBuf = final.finalBody;
            emit({ event: 'hme_continuation_complete', loops: final.loops, bytes: outBuf.length });
            // Continuation loop runs stream:false. Normalize headers.
            delete outHeaders['content-length'];
          }

          const traced = await traceAnthropicResponse({
            isAnthropic,
            outStatus,
            outHeaders,
            outBuf,
            clientReq,
            upstreamHeaders,
            bodyBuf,
            outBody,
            payload,
            final,
            passthrough: _passthrough,
            isOmniRouteSwap: _isOmniRouteSwap,
            swapChain: _swapChain,
            isInteractivePath: _isInteractivePath,
            getConsecutive429s,
            getLastInputTokensRemaining,
            getLastInputTokensLimit,
          });
          outStatus = traced.outStatus;
          outHeaders = traced.outHeaders;
          outBuf = traced.outBuf;

          sendFinalResponse({ clientRes, payload, final, outStatus, outHeaders, outBuf });
          maybeRunStopFallback({
            isAnthropic,
            payload,
            outBuf,
            lifecycleInactive: (event) => lifecycleBridge().lifecycleInactive(event),
            runInlineFallback: (event, stdinJson) => lifecycleBridge().runInlineFallback(event, stdinJson),
          });
        });
        upstreamRes.on('error', (err) => handleMidResponseError({
          err,
          clientRes,
          isInteractivePath: _isInteractivePath,
          releaseOpusSlot: _releaseOpusSlot,
          recordFailure: recordUpstreamFailure,
        }));
      });

      const isStreaming = payload && payload.stream === true;
      // 30-min upstream timeout: covers worst-case multi-MB local subprocess
      // turnaround. The subprocess timeout is the tighter bound; proxy is
      // not the throttle.
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

module.exports = { createClaudeHandler };
