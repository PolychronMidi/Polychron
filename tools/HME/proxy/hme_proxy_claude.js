'use strict';

const http = require('http');
const https = require('https');

const { sessionKey } = require('./shared');
const {
  resolveUpstream, recordUpstreamFailure, isPassthroughMode,
} = require('./upstream');
const { applyOverdriveRoute } = require('./overdrive_route');
const { handleLegacySwapResponse } = require('./legacy_swap_response');
const middleware = require('./middleware/index');
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
const { createFpGateScanner } = require('./hme_proxy_fp_gate');
const { prepareUpstreamHeaders } = require('./hme_proxy_headers');
const { mutateClaudeRequest } = require('./hme_proxy_request_mutation');
const { handleAnthropicResponseComplete } = require('./hme_proxy_anthropic_response');
const { handleMidResponseError, handleConnectionError } = require('./hme_proxy_connection_errors');
const {
  isSingleQuotaProbe,
  isTodoWriteOnlyProbe,
  isStructuredOutputsProbe,
  shouldBlockNoopSystemReminderTurn,
  blockQuotaProbe,
  blockTodoWriteOnlyProbe,
  blockStructuredOutputsProbe,
  blockNoopSystemReminderTurn,
} = require('./prompt_spam_guard');

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
    estimatedContextTokens,
    omniContextThresholdBytes,
    loadedMiddleware = [],
  } = deps;
  const dispatchProxyRoute = createProxyRouteDispatcher({
    PORT,
    PROXY_VERSION,
    PROXY_GIT_SHA,
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

      if (isSingleQuotaProbe(payload)) {
        blockQuotaProbe({ res: clientRes, payload });
        return;
      }
      if (shouldBlockNoopSystemReminderTurn({ req: clientReq, payload, headers: clientReq.headers })) {
        try {
          const fs = require('fs');
          const path = require('path');
          const root = process.env.PROJECT_ROOT;
          if (!root) throw new Error('PROJECT_ROOT not set');
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          fs.writeFileSync(path.join(root, 'tmp', `noop-block-${ts}.json`), JSON.stringify({ url: clientReq.url, headers: clientReq.headers, payload }, null, 2));
        } catch (_e) { /* best effort */ }
        blockNoopSystemReminderTurn({ req: clientReq, res: clientRes, payload });
        return;
      }
      // DDoC instrumentation: capture payloads that PASS guard but whose final
      // user message reduces to empty after stripping system-reminder blocks.
      try {
        const lastUser = [...(payload && payload.messages || [])].reverse().find((m) => m && m.role === 'user');
        if (lastUser) {
          const blocks = Array.isArray(lastUser.content) ? lastUser.content : [];
          const allText = blocks.map((b) => (b && typeof b === 'object' && typeof b.text === 'string') ? b.text : '').join('\n');
          if (/<system-reminder>/i.test(allText)) {
            const stripped = allText.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
            if (stripped === '' || stripped.length < 4) {
              const fs = require('fs');
              const path = require('path');
              const root = process.env.PROJECT_ROOT;
              if (!root) throw new Error('PROJECT_ROOT not set');
              const ts = new Date().toISOString().replace(/[:.]/g, '-');
              fs.writeFileSync(path.join(root, 'tmp', `noop-leak-${ts}.json`), JSON.stringify({ url: clientReq.url, headers: clientReq.headers, payload }, null, 2));
            }
          }
        }
      } catch (_e) { /* best effort */ }
      if (isStructuredOutputsProbe(payload, clientReq.headers)) {
        blockStructuredOutputsProbe({ res: clientRes, payload });
        return;
      }
      if (isTodoWriteOnlyProbe(payload)) {
        blockTodoWriteOnlyProbe({ res: clientRes, payload });
        return;
      }

      let outBody = bodyBuf;
      let injected = false;

      let _legacySwapWasStreaming = false;
      let _isLegacySwap = false;
      let _isOmniRouteSwap = false;
      let _swapChain = [];
      let _swapModel = 'deepseek-v4-pro';
      let _omniProvider = 'opencode-go';

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
        lifecycleInactive: deps.lifecycleInactive || ((event) => lifecycleBridge().lifecycleInactive(event)),
        runInlineFallback: deps.runInlineFallback || ((event, stdinJson) => lifecycleBridge().runInlineFallback(event, stdinJson)),
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
          try {
            await handleAnthropicResponseComplete({
              chunks,
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
