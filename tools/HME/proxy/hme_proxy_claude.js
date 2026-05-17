'use strict';

const http = require('http');
const https = require('https');

const { sessionKey, emit, PROJECT_ROOT } = require('./shared');
const {
  resolveUpstream, recordUpstreamSuccess, recordUpstreamFailure, isPassthroughMode,
  refreshOauthToken,
} = require('./upstream');
const { shouldInject, consumeStatusContext, buildJurisdictionContext, injectIntoLastUserMessage, stripSystemCacheControl, normalizeCacheControlTtls } = require('./context');
const { stripBoilerplate, stripSemanticRedundancy, scanMessages } = require('./messages');
const { applyAnthropicCommonTransforms } = require('./request_transform_core');
const { servicePort } = require('./service_registry');
const { requestTelemetry } = require('./request_telemetry');
const { routeDecision } = require('./model_route_resolver');
const { applyOverdriveRoute } = require('./overdrive_route');
const { handleLegacySwapResponse } = require('./legacy_swap_response');
const {
  detectUpstreamFailure: _detectUpstreamFailure,
  alertCooldownActive: _alertCooldownActive,
} = require('./failure_classification');
const middleware = require('./middleware/index');
const hmeDispatcher = require('./hme_dispatcher');
const { handleMcpRequest } = require('./mcp_server/index');
const { status: supervisorStatus } = require('./supervisor/index');
const {
  lifecycleInactive: _lifecycleInactive,
  runInlineFallback: _runInlineFallback,
  handleLifecycleRoute: _handleLifecycleRoute,
} = require('./lifecycle_bridge');
const { handlePreWriteCheckRoute: _handlePreWriteCheckRoute } = require('./pre_write_route');
const { handleSessionStateRoute: _handleSessionStateRoute } = require('./session_state_route');
const { handleSpawnRoute: _handleSpawnRoute } = require('./routes_admin');
const {
  _stripHmePrefixOutgoing,
  _stripStaleToolResults,
  _stripClaudeIdentity,
  _sanitizePayload,
  _injectHmeTools,
  _injectStopReminderSystem,
  _stopGateHealth,
} = require('./hme_proxy_core');
const { recordOmniRouteFailureAdvance } = require('./hme_proxy_codex');
const { traceAnthropicResponse } = require('./hme_proxy_response_trace');
const { sendFinalResponse, maybeRunStopFallback } = require('./hme_proxy_response_send');

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
    loadedMiddleware,
  } = deps;

  function handleRequest(clientReq, clientRes) {
    if (clientReq.url === '/hme/stop-gate/health') {
      clientRes.writeHead(200, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ status: 'ok', component: 'hme-stop-gate', ..._stopGateHealth() }));
      return;
    }
    if (clientReq.url === '/health') {
      clientRes.writeHead(200, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        status: 'ok', port: PORT, version: PROXY_VERSION, git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT, routes: _routeMetrics, supervisor: supervisorStatus(),
      }));
      return;
    }
    if (clientReq.url === '/version') {
      clientRes.writeHead(200, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ version: PROXY_VERSION, component: 'hme-proxy' }));
      return;
    }
    // Ad-hoc spawn API: POST /hme/spawn, GET /hme/spawn, GET/DELETE /hme/spawn/<id>
    if (clientReq.url && clientReq.url.startsWith('/hme/spawn')) {
      _handleSpawnRoute(clientReq, clientRes);
      return;
    }
    // Lifecycle bridge: proxy-dispatch Claude Code hook events.
    if (clientReq.url && clientReq.url.startsWith('/hme/lifecycle')) {
      _handleLifecycleRoute(clientReq, clientRes);
      return;
    }
    if (clientReq.url && clientReq.url.startsWith('/hme/pre-write-check')) {
      _handlePreWriteCheckRoute(clientReq, clientRes);
      return;
    }
    if (clientReq.url && clientReq.url.startsWith('/hme/session/')) {
      _handleSessionStateRoute(clientReq, clientRes);
      return;
    }
    // Route MCP requests to the proxy-native MCP server.
    if (clientReq.url && clientReq.url.startsWith('/mcp')) {
      handleMcpRequest(clientReq, clientRes);
      return;
    }
    // Short-circuit useless probes BEFORE forwarding -- they burn the
    // Cloudflare per-IP rate budget and 429 real interactive requests.
    // Routine browser/monitor probes; drop silently.
    const _USELESS_PATHS = ['/', '/favicon.ico', '/robots.txt'];
    if (clientReq.url && _USELESS_PATHS.includes(clientReq.url)) {
      clientRes.writeHead(404, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'not_found', note: 'hme-proxy: useless-path probe short-circuited (not forwarded to Anthropic)' }));
      return;
    }
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

      const _passthrough = isPassthroughMode();

      if (_passthrough && isAnthropic && _isInteractivePath && payload && Array.isArray(payload.messages)) {
        const _dropped = _shrinkForPassthrough(payload);
        if (_dropped > 0) {
          outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        }
        const _otpmCapRaw = process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
        if (_otpmCapRaw) {
          const _otpmCap = parseInt(_otpmCapRaw, 10);
          const _maxTokensCap = _otpmCap + 2048;
          let _capChanged = false;
          if (payload.thinking && typeof payload.thinking === 'object') {
            if (typeof payload.thinking.budget_tokens === 'number' && payload.thinking.budget_tokens > _otpmCap) {
              console.error(`OTPM-cap (explicit): thinking.budget_tokens ${payload.thinking.budget_tokens} -> ${_otpmCap}`);
              payload.thinking.budget_tokens = _otpmCap;
              _capChanged = true;
            }
          }
          if (typeof payload.max_tokens === 'number' && payload.max_tokens > _maxTokensCap) {
            console.error(`OTPM-cap (explicit): max_tokens ${payload.max_tokens} -> ${_maxTokensCap}`);
            payload.max_tokens = _maxTokensCap;
            _capChanged = true;
          }
          if (_capChanged) {
            outBody = Buffer.from(JSON.stringify(payload), 'utf8');
          }
        }
      }

      if (payload && Array.isArray(payload.messages) && !_passthrough) {
        const session = sessionKey(payload);
        let bodyDirtiedByStrip = false;
        if (isAnthropic) {
          try {
            require('./_dump').writeDump(
              payload, require('./shared').PROJECT_ROOT, 'pre',
              (m) => console.warn('Acceptable warning: [middleware]', m),
            );
          } catch (err) {
            console.error(`pre-dump failed: ${err.message}`);
          }
          if (process.env.HME_REPLACE_SYSTEM_PROMPT === '1') {
            if (stripSystemCacheControl(payload)) bodyDirtiedByStrip = true;
          }
          const common = applyAnthropicCommonTransforms(payload);
          const iw = common.i.command_rewrites + common.i.text_rewrites;
          const hns = common.hook_noise;
          const b = stripBoilerplate(payload);
          const s = stripSemanticRedundancy(payload);
          const r = _stripHmePrefixOutgoing(payload);
          const n = await _injectHmeTools(payload);
          _sanitizePayload(payload);
          if (iw > 0 || hns.stripped > 0 || common.sanitized > 0 || b > 0 || s > 0 || r || n > 0) bodyDirtiedByStrip = true;
        }

        let scan = null;
        if (isAnthropic) {
          scan = scanMessages(payload);
          if (_lifecycleInactive('UserPromptSubmit')) {
            const last = payload && Array.isArray(payload.messages)
              ? payload.messages[payload.messages.length - 1] : null;
            if (last && last.role === 'user') {
              let promptText = '';
              if (typeof last.content === 'string') promptText = last.content;
              else if (Array.isArray(last.content)) {
                promptText = last.content
                  .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                  .map((b) => b.text).join('\n');
              }
              if (promptText) {
                const stdin = JSON.stringify({ user_prompt: promptText, session_id: session });
                _runInlineFallback('UserPromptSubmit', stdin);
              }
            }
          }
          try {
            const mwDirtied = await middleware.runPipeline(payload, scan, session);
            if (mwDirtied) bodyDirtiedByStrip = true;
          } catch (err) {
            console.error('middleware pipeline error:', err.message);
          }
          if (_injectStopReminderSystem(payload)) {
            emit({ event: 'stop_reminder_inject', session });
            bodyDirtiedByStrip = true;
          }
          if (shouldInject()) {
            const statusBlock = consumeStatusContext(session);
            if (statusBlock) {
              const injectedStatus = injectIntoLastUserMessage(payload, statusBlock.trim(), 'HME Session Status (proxy-injected)');
              if (injectedStatus) {
                emit({ event: 'status_inject', session });
                bodyDirtiedByStrip = true;
              }
            }
            if (scan.jurisdictionTargets.length > 0) {
              const block = buildJurisdictionContext(scan.jurisdictionTargets);
              injected = injectIntoLastUserMessage(payload, block, 'HME Jurisdiction Context (proxy-injected)');
              if (injected) {
                emit({
                  event: 'jurisdiction_inject',
                  session,
                  targets: scan.jurisdictionTargets.length,
                  first_target: (scan.jurisdictionTargets[0] || '').replace(/[,=\s]/g, '_'),
                });
                bodyDirtiedByStrip = true;
              }
            }
          }
          const ccChanged = normalizeCacheControlTtls(payload);
          if (ccChanged > 0) {
            bodyDirtiedByStrip = true;
            emit({ event: 'cache_control_normalized', session, count: ccChanged });
          }
          if (bodyDirtiedByStrip) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        }

        emit({
          event: 'inference_call',
          session,
          provider: upstream.provider,
          path: clientReq.url || '?',
          model: (payload.model || 'unknown').replace(/[,=\s]/g, '_'),
          messages: payload.messages.length,
          injected: injected,
          route_decision: routeDecision({ host: 'claude', requestedModel: payload.model || '', provider: upstream.provider, protocol: 'anthropic-messages', route: upstream.provider }),
          telemetry: requestTelemetry({ host: 'claude', protocol: 'anthropic-messages', provider: upstream.provider, route: upstream.provider, path: clientReq.url || '?', body: payload, stream: payload.stream }),
        });
      }

      const upstreamHeaders = { ...clientReq.headers };
      delete upstreamHeaders.host;
      delete upstreamHeaders['content-length'];
      delete upstreamHeaders['x-hme-upstream'];
      upstreamHeaders.host = upstream.host;
      if (outBody.length > 0) upstreamHeaders['content-length'] = String(outBody.length);

      if (isAnthropic) {
        delete upstreamHeaders['accept-encoding'];
      }

      if (isAnthropic && typeof upstreamHeaders['authorization'] === 'string'
          && upstreamHeaders['authorization'].startsWith('Bearer ')) {
        if (!upstreamHeaders['anthropic-beta']) {
          upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
        }
      }

      if (isAnthropic
          && !_isOmniRouteSwap
          && !upstreamHeaders['authorization']
          && !upstreamHeaders['x-api-key']) {
        const remoteAddr = (clientReq.socket && clientReq.socket.remoteAddress) || '';
        const isLoopback = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
        if (isLoopback) {
          try {
            const credsPath = require('path').join(require('os').homedir(), '.claude/.credentials.json');
            const creds = JSON.parse(require('fs').readFileSync(credsPath, 'utf8'));
            const token = creds && creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
            if (token) {
              upstreamHeaders['authorization'] = `Bearer ${token}`;
              if (!upstreamHeaders['anthropic-beta']) {
                upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
              }
              console.error(`injected OAuth token for loopback request (path=${clientReq.url})`);
            }
          } catch (_err) {
            console.error(`auth injection failed: ${_err.message}`);
          }
        }
      }

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
      const _CONNRETRY_ENABLED = process.env.HME_PROXY_CONNRESET_RETRY === '1';
      const _CONNRETRY_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);
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

        // FP-CHECK upstream-kill: detect `[FP-CHECK: yes]` in TEXT-block
        // text_delta-only marker scan: bare-substring matched thinking blocks
        // and killed streams when the model reasoned ABOUT the marker. Regex
        // requires `text_delta` and marker in the same SSE event line.
        let _fpKillTriggered = false;
        let _fpTrailingBuf = '';
        let _fpEligible = false;
        try {
          const _fpMsgs = (payload && payload.messages) || [];
          let _fpLastUserText = '';
          for (const m of _fpMsgs) {
            if (!m || m.role !== 'user') continue;
            const c = m.content;
            if (typeof c === 'string') {
              _fpLastUserText = c;
            } else if (Array.isArray(c)) {
              _fpLastUserText = c.filter((b) => b && b.type === 'text')
                .map((b) => b.text || '').join(' ') || lastUserText;
            }
          }
          const _fpDenyMarkers = [
            'Stop hook feedback:',
            'Stop hook blocking error from command:',
            'AUTO-COMPLETENESS',
            'EXHAUST PROTOCOL',
            'PSYCHOPATHIC-STOP',
            'STOP-WORK ANTIPATTERN',
            'ADVISOR DOCTRINE',
            'PHANTOM CAPABILITY',
            'PHANTOM PARAPHRASE',
            'SPECULATION-DEBT SCAN',
            'SCOPE-ESCAPE VIOLATION',
            'NEXUS --',
            'VERIFICATION DOCTRINE',
            'SYSTEMATIC-DEBUGGING PHASE GATE',
          ];
          _fpEligible = _fpLastUserText && _fpDenyMarkers.some((m) => _fpLastUserText.includes(m));
        } catch (_e) { /* best-effort -- if we can't detect eligibility, no kill */ }

        // text_delta event contains both the discriminator and the marker
        // text in the same JSON line. thinking_delta uses field "thinking"
        const _FP_TEXT_DELTA_RE = /"type"\s*:\s*"text_delta"[\s\S]{0,200}\[FP-CHECK:\s*yes\]|\[FP-CHECK:\s*yes\][\s\S]{0,200}"type"\s*:\s*"text_delta"/;

        upstreamRes.on('data', (c) => {
          chunks.push(c);
          if (!_fpEligible || _fpKillTriggered) return;
          try {
            const chunkStr = c.toString('utf8');
            const scan = _fpTrailingBuf + chunkStr;
            if (_FP_TEXT_DELTA_RE.test(scan)) {
              _fpKillTriggered = true;
              try {
                const fs2 = require('fs');
                const path2 = require('path');
                fs2.appendFileSync(
                  path2.join(PROJECT_ROOT, 'log', 'hme-fp-gate-kills.jsonl'),
                  JSON.stringify({
                    ts: new Date().toISOString(),
                    bytes_before_kill: chunks.reduce((acc, b) => acc + b.length, 0),
                  }) + '\n',
                );
              } catch (_e) { /* stat is best-effort */ }
              try { upstreamReq.destroy(); } catch (_e) { /* ignore */ }
            } else {
              // Trailing buffer must cover both the regex window AND the
              // marker length. 600 bytes covers a text_delta + 200-char
              _fpTrailingBuf = scan.slice(-600);
            }
          } catch (_e) { /* scan is best-effort */ }
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

          // Detect upstream failure: HTTP 4xx JSON error OR HTTP 200 + SSE
          // error event. First-hit escape-hatch trip + LIFESAVER alert +
          // body snapshot. Without SSE coverage, streamed errors bypassed.
          const _proxyMutatedBody = isAnthropic && !_passthrough;
          if (_proxyMutatedBody) {
            const _errInfo = _detectUpstreamFailure(status, headers, fullBody);
            if (_errInfo) {
              const _isOmniRouteErr = _isOmniRouteSwap;
              const _provider = _isOmniRouteErr ? 'omniroute' : 'anthropic';
              const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
              const _errMsg = `${_provider} ${status} ${_errInfo.type || 'error'} [${_pathLabel}]: ${_errInfo.message || '<no message>'}`;
              const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
              const _snapshotRel = `tmp/claude-${status}-${_pathLabel}-payload-${_stamp}.json`;
              console.error(`UPSTREAM FAILURE detected: ${_errMsg}`);
              // Only INTERACTIVE-path 4xx/5xx trips the global escape hatch.
              // Sub-pipeline failures self-handle via internal circuit breakers;
              // global trip on them puts Claude Code into passthrough.
              const _coolingDown = _alertCooldownActive(_errInfo.type || `http_${status}`, _pathLabel);
              const _shouldRetry = headers['x-should-retry'] === 'true';
              const _isRateLimit = _errInfo.type === 'rate_limit_error';

              // MODE=1 OmniRoute fallback: advance to next model in E5 chain on failure.
              recordOmniRouteFailureAdvance({
                isOmniRouteSwap: _isOmniRouteSwap,
                swapChain: _swapChain,
                odMode: _odMode,
                omniProvider: _omniProvider,
                swapModel: _swapModel,
                status,
                isRateLimit: _isRateLimit,
                projectRoot: PROJECT_ROOT,
              });

              // ITPM-exhaustion bumps panic-shrink so next request is smaller.
              if (_isRateLimit && !_shouldRetry) {
                incConsecutive429s();
                console.error(`rate_limit_error (ITPM-exhaustion) -- panic-shrink counter=${getConsecutive429s()}, next threshold=${_effectiveCompactThreshold()}B`);
              } else if (_isRateLimit && _shouldRetry) {
                console.error(`rate_limit_error (Cloudflare per-IP throttle) -- skip panic-shrink (size irrelevant)`);
              }
              // Trip escape hatch on every interactive 4xx (incl x-should-retry
              // 429s -- user wants the lifesaver alert as recovery signal).
              // MODE=1: never trip the escape hatch (OmniRoute errors must not
              // cause passthrough to api.anthropic.com).
              if (_isInteractivePath && !_coolingDown && process.env.OVERDRIVE_MODE !== '1') {
                recordUpstreamFailure(_errMsg);
              } else if (_isInteractivePath) {
                console.error(`escape hatch SUPPRESSED (OVERDRIVE_MODE=${process.env.OVERDRIVE_MODE || '0'}, _isOmniRouteSwap=${_isOmniRouteSwap}) -- passthrough blocked`);
              } else if (!_isInteractivePath) {
                console.error(`sub-pipeline failure -- NOT tripping escape hatch (interactive path unaffected)`);
              }
              try {
                const fs = require('fs');
                const path = require('path');
                const { PROJECT_ROOT } = require('./shared');
                const outFile = path.join(PROJECT_ROOT, _snapshotRel);
                fs.mkdirSync(path.dirname(outFile), { recursive: true });
                fs.writeFileSync(outFile, outBody);
                fs.writeFileSync(outFile.replace('.json', '.response'), fullBody);
                fs.writeFileSync(outFile.replace('.json', '.headers.json'), JSON.stringify(headers, null, 2));
                try {
                  const _reqHdrSnap = {
                    method: clientReq.method,
                    url: clientReq.url,
                    incoming_headers: clientReq.headers,
                    outgoing_headers: upstreamHeaders,
                  };
                  fs.writeFileSync(outFile.replace('.json', '.request-headers.json'), JSON.stringify(_reqHdrSnap, null, 2));
                } catch (_e) { /* best-effort */ }
                console.error(`payload snapshotted to ${outFile}`);
                // Sub-pipeline failures are diagnostic noise; interactive failures alert.
                const _suppressLifesaver = _coolingDown || _pathLabel === 'sub-pipeline';
                if (!_suppressLifesaver) {
                  const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
                  fs.appendFileSync(errLog,
                    `[${_stamp}] UPSTREAM_${status}_${_pathLabel.toUpperCase()}: ${_errMsg} (request_id=${_errInfo.requestId || '?'}, snapshot=${_snapshotRel})\n`);
                }
              } catch (err) {
                console.error(`snapshot/lifesaver write failed: ${err.message}`);
              }
              emit({ event: 'upstream_error', session: _sessionForTelemetry, status, type: _errInfo.type, message: _errInfo.message, path_label: _pathLabel });
              // No retry on 429: Cloudflare's sustained throttle window means
              // retries extend it.
              const _isBearerAuth = typeof upstreamHeaders['authorization'] === 'string'
                && upstreamHeaders['authorization'].startsWith('Bearer ');
              if (status === 401 && _isBearerAuth && payload && Array.isArray(payload.messages)) {
                try {
                  console.error('got 401, attempting token refresh + retry');
                  const newToken = await refreshOauthToken();
                  const retryHeaders = { ...upstreamHeaders, 'authorization': `Bearer ${newToken}` };
                  retryHeaders['content-length'] = String(outBody.length);
                  const retryOpts = { ...upstreamOpts, headers: retryHeaders };
                  const retry = await new Promise((resolve, reject) => {
                    const req = transport.request(retryOpts, (res) => {
                      const cs = [];
                      res.on('data', (c) => cs.push(c));
                      res.on('end', () => resolve({ statusCode: res.statusCode || 502, headers: { ...res.headers }, body: Buffer.concat(cs) }));
                      res.on('error', reject);
                    });
                    req.on('error', reject);
                    req.write(outBody);
                    req.end();
                  });
                  console.error(`401-retry response: ${retry.statusCode}`);
                  if (retry.statusCode >= 200 && retry.statusCode < 300) {
                    status = retry.statusCode;
                    headers = retry.headers;
                    fullBody = retry.body;
                    recordUpstreamSuccess();
                  }
                } catch (refreshErr) {
                  console.error(`401-refresh failed: ${refreshErr.message}`);
                }
              }
            } else {
              recordUpstreamSuccess();
              if (getConsecutive429s() > 0) {
                console.error(`success -- resetting panic-shrink counter (was ${getConsecutive429s()})`);
                setConsecutive429s(0);
              }
            }
          } else if (status >= 200 && status < 300) {
            recordUpstreamSuccess();
            if (getConsecutive429s() > 0) {
              console.error(`success -- resetting panic-shrink counter (was ${getConsecutive429s()})`);
              setConsecutive429s(0);
            }
          }

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
            lifecycleInactive: _lifecycleInactive,
            runInlineFallback: _runInlineFallback,
          });
        });
        upstreamRes.on('error', (err) => {
          try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
          // Mid-response failures (connection reset while streaming, TLS
          // mid-frame, etc). Same lifesaver discipline as the connection-
          // time and response-complete error paths.
          const _errCode = err.code || 'mid_response';
          const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
          const _errMsg = `upstream ${_errCode} mid-response [${_pathLabel}]: ${err.message}`;
          console.error(`upstream read error: ${_errMsg}`);
          if (_isInteractivePath) {
            recordUpstreamFailure(_errMsg);
          }
          try {
            const fs = require('fs');
            const path = require('path');
            const { PROJECT_ROOT } = require('./shared');
            const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
            fs.appendFileSync(errLog,
              `[${_stamp}] UPSTREAM_${_errCode}_${_pathLabel.toUpperCase()}_MIDRESPONSE: ${_errMsg}\n`);
          } catch (_e) { /* lifesaver write best-effort; the console log above already surfaced it */ }
          emit({ event: 'upstream_midresponse_error', code: _errCode, message: err.message, path_label: _pathLabel });
          if (!clientRes.headersSent) {
            clientRes.writeHead(502, { 'Content-Type': 'application/json' });
            clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_upstream_midresponse', code: _errCode, message: err.message } }));
          } else {
            clientRes.end();
          }
        });
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

      upstreamReq.on('error', (err) => {
        try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
        const _errCode = err.code || 'unknown';
        const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
        // Single-shot retry: env-gated, retryable code, pre-headers, first attempt only.
        if (_CONNRETRY_ENABLED && _isInteractivePath && _connAttempt === 1
            && !clientRes.headersSent && _CONNRETRY_CODES.has(_errCode)) {
          console.error(`${_errCode} -- single retry (HME_PROXY_CONNRESET_RETRY=1)`);
          return _spawnUpstream();
        }
        const _errMsg = `upstream ${_errCode} [${_pathLabel}]: ${err.message}`;
        console.error(`upstream connection error: ${_errMsg}`);
        if (_isInteractivePath) {
          recordUpstreamFailure(_errMsg);
        } else {
          console.error('sub-pipeline conn-error -- NOT tripping escape hatch');
        }
        try {
          const fs = require('fs');
          const path = require('path');
          const { PROJECT_ROOT } = require('./shared');
          const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const _snapshotRel = `tmp/claude-${_errCode}-${_pathLabel}-payload-${_stamp}.json`;
          const outFile = path.join(PROJECT_ROOT, _snapshotRel);
          fs.mkdirSync(path.dirname(outFile), { recursive: true });
          fs.writeFileSync(outFile, outBody);
          if (_pathLabel === 'interactive') {
            const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
            fs.appendFileSync(errLog,
              `[${_stamp}] UPSTREAM_${_errCode}_${_pathLabel.toUpperCase()}: ${_errMsg} (snapshot=${_snapshotRel})\n`);
          }
        } catch (snapErr) {
          console.error(`conn-error snapshot/lifesaver write failed: ${snapErr.message}`);
        }
        emit({ event: 'upstream_conn_error', code: _errCode, message: err.message, path_label: _pathLabel });
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_upstream', code: _errCode, message: err.message } }));
        } else {
          clientRes.end();
        }
      });

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
