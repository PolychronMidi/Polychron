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
const { _detectUpstreamFailure, _alertCooldownActive } = require('./failure_classification');
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
} = require('./hme_proxy_core');
const { recordOmniRouteFailureAdvance, retryBlankOmniRouteResponse } = require('./hme_proxy_codex');

function createClaudeHandler(deps) {
  const {
    PORT, PROXY_VERSION, PROXY_GIT_SHA, PROXY_STARTED_AT, routeMetrics,
    recordProxyRoute, recordProxyError: _recordProxyError,
    WORKER_PORT,
    SUPERVISE,
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
    getLastPayloadBytes,
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
        if (overdriveRoute.lastPayloadBytes) _lastPayloadBytes = overdriveRoute.lastPayloadBytes;
      }

      const upstream = resolveUpstream(clientReq);
      _recordProxyRoute(_isOmniRouteSwap ? 'omniroute' : (_isLegacySwap ? 'legacy_swap' : (isPassthroughMode() ? 'passthrough' : 'direct')), payload && payload.model);
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
          const ct = (upstreamRes.headers['content-type'] || '').toLowerCase();

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
            if (Number.isFinite(n) && n >= 0) _lastInputTokensRemaining = n;
          }
          if (_hdrTokLimit != null) {
            const n = parseInt(_hdrTokLimit, 10);
            if (Number.isFinite(n) && n > 0) _lastInputTokensLimit = n;
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
                _consecutive429s = Math.min(_consecutive429s + 1, 4);
                console.error(`rate_limit_error (ITPM-exhaustion) -- panic-shrink counter=${_consecutive429s}, next threshold=${_effectiveCompactThreshold()}B`);
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
              if (_consecutive429s > 0) {
                console.error(`success -- resetting panic-shrink counter (was ${_consecutive429s})`);
                _consecutive429s = 0;
              }
            }
          } else if (status >= 200 && status < 300) {
            recordUpstreamSuccess();
            if (_consecutive429s > 0) {
              console.error(`success -- resetting panic-shrink counter (was ${_consecutive429s})`);
              _consecutive429s = 0;
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

          // EXHAUSTIVE RESPONSE DUMPER: complete bodies/headers/events per
          // transaction. Rotates last 200; each dump self-contained.
          try {
            if (!isAnthropic) throw new Error('skip-non-anthropic');
            const _bdPath = require('path');
            const _bdFs = require('fs');
            const { PROJECT_ROOT: _bdRoot } = require('./shared');
            const _dumpDir = _bdPath.join(_bdRoot, 'tmp', 'blank-debug');
            try { _bdFs.mkdirSync(_dumpDir, { recursive: true }); } catch (_e) { /* ignore */ }
            // Rotate: keep newest 199 (about to write #200).
            try {
              const _existing = _bdFs.readdirSync(_dumpDir)
                .filter((n) => n.startsWith('hme-resp-') && (n.endsWith('.json') || n.endsWith('.body')))
                .map((n) => ({ n, t: _bdFs.statSync(_bdPath.join(_dumpDir, n)).mtimeMs }))
                .sort((a, b) => b.t - a.t);
              for (const { n } of _existing.slice(199 * 2)) {
                try { _bdFs.unlinkSync(_bdPath.join(_dumpDir, n)); } catch (_e) { /* ignore */ }
              }
            } catch (_e) { /* ignore rotation errors */ }

            const _isSse = (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
            const _bodyStr = outBuf.toString('utf8');
            let _textChars = 0;
            let _textBlocks = 0;
            let _thinkingChars = 0;
            let _thinkingBlocks = 0;
            let _toolUseBlocks = 0;
            let _stopReason = null;
            let _errorEventsSeen = [];
            const _events = [];
            if (_isSse) {
              for (const evRaw of _bodyStr.split('\n\n')) {
                if (!evRaw.trim()) continue;
                let evName = '';
                let evDataLines = [];
                for (const line of evRaw.split('\n')) {
                  if (line.startsWith('event: ')) evName = line.slice(7).trim();
                  else if (line.startsWith('data: ')) evDataLines.push(line.slice(6));
                }
                const evDataStr = evDataLines.join('\n');
                let evData = null;
                try { evData = JSON.parse(evDataStr); } catch (_e) { /* skip non-JSON */ }
                _events.push({ event: evName, data: evData });
                try {
                  const { reasoningTextFromData } = require('./reasoning_to_thinking');
                  const _rt = reasoningTextFromData(evData);
                  if (_rt) _thinkingChars += _rt.length;
                } catch (_e) { /* diagnostics only */ }
                if (evName === 'content_block_start' && evData && evData.content_block) {
                  const t = evData.content_block.type;
                  if (t === 'text') _textBlocks++;
                  else if (t === 'thinking') _thinkingBlocks++;
                  else if (t === 'tool_use') _toolUseBlocks++;
                } else if (evName === 'content_block_delta' && evData && evData.delta) {
                  if (evData.delta.type === 'text_delta' && typeof evData.delta.text === 'string') {
                    _textChars += evData.delta.text.length;
                  } else if (evData.delta.type === 'thinking_delta' && typeof evData.delta.thinking === 'string') {
                    _thinkingChars += evData.delta.thinking.length;
                  }
                } else if (evName === 'message_delta' && evData && evData.delta && evData.delta.stop_reason) {
                  _stopReason = evData.delta.stop_reason;
                } else if (evName === 'error') {
                  _errorEventsSeen.push(evData);
                }
              }
            }
            // Verdict: visible to user? text_chars>0 OR tool_use blocks present.
            const _isBlank = _textChars === 0 && _toolUseBlocks === 0;
            const _verdict = _isBlank ? 'BLANK' : 'OK';
            console.error(`[hme-proxy] verdict=${_verdict} omni=${_isOmniRouteSwap} chain=${_swapChain.length} blank=${_isBlank} text=${_textChars} tools=${_toolUseBlocks}`);

            const _blankRetry = await retryBlankOmniRouteResponse({
              isBlank: _isBlank,
              isOmniRouteSwap: _isOmniRouteSwap,
              swapChain: _swapChain,
              payload,
              outStatus,
              outBuf,
              outHeaders,
              projectRoot: _bdRoot,
            });
            if (_blankRetry) {
              outStatus = _blankRetry.outStatus;
              outBuf = _blankRetry.outBuf;
              outHeaders = _blankRetry.outHeaders;
            }

            const _ts = new Date().toISOString().replace(/[:.]/g, '-');
            const _path_label = _isInteractivePath ? 'interactive' : 'sub';
            const _corrId = `${_ts}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
            const _dumpFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.json`);
            const _bodyFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.body`);
            const _reqBodyFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.reqBody`);
            // Filter env to relevant vars (avoid dumping secrets like OAuth
            // tokens or API keys, but keep behaviour-influencing config).
            const _envSnap = {};
            for (const [k, v] of Object.entries(process.env)) {
              if (/^(HME_|CLAUDE_CODE_|ANTHROPIC_(BASE_URL|MODEL|VERSION|BETA))/.test(k)) {
                _envSnap[k] = v;
              }
            }
            // Sanitize headers: scrub auth bearer / api-key but keep header
            // PRESENCE (key-listed) so we can tell whether Claude Code sent
            // auth at all.
            const _sanitize = (h) => {
              const out = {};
              for (const [k, v] of Object.entries(h || {})) {
                const lk = String(k).toLowerCase();
                if (lk === 'authorization' || lk === 'x-api-key' || lk === 'cookie') {
                  out[k] = typeof v === 'string'
                    ? `<redacted len=${v.length} prefix=${v.slice(0, 12)}...>`
                    : '<redacted>';
                } else { out[k] = v; }
              }
              return out;
            };
            const _dump = {
              ts: new Date().toISOString(),
              corr_id: _corrId,
              verdict: _verdict,
              path_label: _path_label,
              request: {
                method: clientReq.method,
                url: clientReq.url,
                client_headers: _sanitize(clientReq.headers),
                upstream_outgoing_headers: _sanitize(upstreamHeaders),
                body_bytes: bodyBuf.length,
                outBody_bytes: outBody.length,
                proxy_mutated_body: outBody.length !== bodyBuf.length,
                payload_summary: payload ? {
                  model: payload.model,
                  thinking: payload.thinking,
                  output_config: payload.output_config,
                  max_tokens: payload.max_tokens,
                  stream: payload.stream,
                  temperature: payload.temperature,
                  messages_count: Array.isArray(payload.messages) ? payload.messages.length : 0,
                  system_block_count: Array.isArray(payload.system) ? payload.system.length : (payload.system ? 1 : 0),
                  system_total_chars: Array.isArray(payload.system)
                    ? payload.system.reduce((acc, b) => acc + ((b && b.text) ? b.text.length : 0), 0)
                    : (typeof payload.system === 'string' ? payload.system.length : 0),
                  tools_count: Array.isArray(payload.tools) ? payload.tools.length : 0,
                  betas: payload.betas,
                  tool_choice: payload.tool_choice,
                  metadata: payload.metadata,
                } : null,
              },
              response: {
                status: outStatus,
                headers: outHeaders,
                body_bytes: outBuf.length,
                is_sse: _isSse,
                had_continuation: !!final,
                text_chars: _textChars,
                thinking_chars: _thinkingChars,
                text_blocks: _textBlocks,
                thinking_blocks: _thinkingBlocks,
                tool_use_blocks: _toolUseBlocks,
                total_events: _events.length,
                stop_reason: _stopReason,
                error_events: _errorEventsSeen,
              },
              // Full parsed event log so we can see EXACTLY what came back,
              // event-by-event. No truncation.
              events: _events,
              // Proxy state at the time of the response.
              proxy_state: {
                passthrough_mode: _passthrough,
                consecutive_429s: typeof _consecutive429s !== 'undefined' ? _consecutive429s : null,
                last_input_tokens_remaining: typeof _lastInputTokensRemaining !== 'undefined' ? _lastInputTokensRemaining : null,
                last_input_tokens_limit: typeof _lastInputTokensLimit !== 'undefined' ? _lastInputTokensLimit : null,
                proxy_pid: process.pid,
                proxy_uptime_s: Math.round(process.uptime()),
              },
              env_snapshot: _envSnap,
            };
            try {
              // Write the structured JSON dump.
              _bdFs.writeFileSync(_dumpFile, JSON.stringify(_dump, null, 2));
              // Write FULL raw response body alongside (binary-safe). This
              // is the unmodified bytes the client receives, so any encoding
              // weirdness is preserved exactly. No size cap.
              _bdFs.writeFileSync(_bodyFile, outBuf);
              // Write FULL incoming request body too (post any proxy
              // mutation -- this is what's about to be sent upstream OR was
              // received from Claude Code, depending on outBody === bodyBuf).
              _bdFs.writeFileSync(_reqBodyFile, outBody);
              console.error(`dump ${_verdict}/${_path_label} status=${outStatus} sse=${_isSse} textC=${_textChars} thC=${_thinkingChars} blocks=${_textBlocks}t/${_thinkingBlocks}th/${_toolUseBlocks}tu stop=${_stopReason} bodyB=${outBuf.length} reqB=${outBody.length} -> ${_dumpFile}`);
            } catch (_e) { console.error(`dump write failed: ${_e.message} stack=${_e.stack}`); }
          } catch (_e) {
            if (_e && _e.message === 'skip-non-anthropic') { /* expected */ }
            else { console.error(`response-trace dumper threw: ${_e.message} stack=${_e.stack}`); }
          }

          // Strip content-length on ANY SSE-mutation path. SseTransform
          // changes byte count; stale CL stalls or truncates the client.
          const _willSseTransform = !final
            && (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
          // Strip stale content-length on EITHER mutation path: SSE transform
          // changes byte count, AND the non-SSE bare-ack-strip rewrite
          // (below) can shrink the body. Without strip, clients see length
          // mismatch and stall or truncate. Cost: chunked encoding.
          if (_willSseTransform || !final) {
            outHeaders = { ...outHeaders };
            delete outHeaders['content-length'];
          }

          clientRes.writeHead(outStatus, outHeaders);

          // Apply SSE transforms only if this is an SSE response being forwarded.
          const isSseFinal = (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
          if (isSseFinal && !final) {
            // Original streaming path (no HME interception happened) -- pipe
            // through the Transform for Bash run_in_background rewriting.
            const { SseTransform } = require('./sse_transform');
            const { readInputNormalizeRewrite, bashPolicyRewrite, runInBackgroundRewrite, longLeadingSleepRewrite, ackStripRewrite, slopStripRewrite, hallucinatedTurnPrefixStripRewrite, stopHookCeremonyStripRewrite, fpGateMarkerRewrite, soloRationaleTrimRewrite } = require('./sse_rewriters');
            const { providerReasoningToThinkingRewrite } = require('./reasoning_to_thinking');
            // Order: longLeadingSleep rewrites BEFORE runInBackground reads
            // (both keyed by content-block index for consistent state).
            // Chain order is encoded in the rewriters[] array below.
            const xform = new SseTransform({
              // fpGateMarker FIRST -- handles [FP-CHECK: yes/no] marker (yes ->
              // truncate to `.`; no -> strip marker line). soloRationaleTrim
              // LAST -- surgical trim of trailing rationale paragraph.
              rewriters: [readInputNormalizeRewrite, providerReasoningToThinkingRewrite, fpGateMarkerRewrite, stopHookCeremonyStripRewrite, hallucinatedTurnPrefixStripRewrite, bashPolicyRewrite, longLeadingSleepRewrite, runInBackgroundRewrite, ackStripRewrite, slopStripRewrite, soloRationaleTrimRewrite],
            });
            // Populate priorUserWasDeny flag for the ack-strip rewriter:
            // last user message matches a hook-deny payload marker.
            try {
              const msgs = (payload && payload.messages) || [];
              let lastUserText = '';
              for (const m of msgs) {
                if (!m || m.role !== 'user') continue;
                const c = m.content;
                if (typeof c === 'string') {
                  lastUserText = c;
                } else if (Array.isArray(c)) {
                  lastUserText = c.filter((b) => b && b.type === 'text')
                    .map((b) => b.text || '').join(' ') || lastUserText;
                }
              }
              const denyMarkers = [
                'Stop hook feedback:',
                'Stop hook blocking error from command:',
                'AUTO-COMPLETENESS',
                'EXHAUST PROTOCOL',
                'PreToolUse:',
                'PostToolUse:',
              ];
              const _denyHit = lastUserText && denyMarkers.some((m) => lastUserText.includes(m));
              if (_denyHit) {
                xform._ctx.set('priorUserWasDeny', true);
              }
              // Diagnostic: log every SSE response we set up the strip
              // for, so we can verify the path is being reached and
              // priorUserWasDeny is being set correctly.
              try {
                const fs = require('fs');
                const path = require('path');
                fs.appendFileSync(
                  path.join(PROJECT_ROOT, 'log', 'hme-proxy-ackstrip.log'),
                  `[${new Date().toISOString()}] sse-setup priorUserWasDeny=${_denyHit} lastUserHead=${JSON.stringify(lastUserText.slice(0,80))}\n`,
                );
              } catch (_e) { /* best-effort */ }
            } catch (_e) { /* best-effort */ }
            xform.pipe(clientRes);
            xform.end(outBuf);
          } else {
            // Non-streaming: scan body for bare-ack text blocks; emit a
            // LIFESAVER entry on detection so next turn sees it. Strip also
            // runs when conditions match (defense in depth).
            try {
              const msgs = (payload && payload.messages) || [];
              let lastUserText = '';
              for (const m of msgs) {
                if (!m || m.role !== 'user') continue;
                const c = m.content;
                if (typeof c === 'string') {
                  lastUserText = c;
                } else if (Array.isArray(c)) {
                  lastUserText = c.filter((b) => b && b.type === 'text')
                    .map((b) => b.text || '').join(' ') || lastUserText;
                }
              }
              const denyMarkers = [
                'Stop hook feedback:',
                'Stop hook blocking error from command:',
                'AUTO-COMPLETENESS',
                'EXHAUST PROTOCOL',
                'PreToolUse:',
                'PostToolUse:',
              ];
              const userIsDeny = lastUserText && denyMarkers.some((m) => lastUserText.includes(m));
              const outStr = outBuf.toString('utf8');
              if (outStr.trimStart().startsWith('{')) {
                const parsed = JSON.parse(outStr);
                if (parsed && Array.isArray(parsed.content)) {
                  // Use the canonical ack detector from sse_rewriters so the
                  // SSE and non-SSE paths stay in sync. Keyword templates
                  // PLUS minimal/punctuation-only/empty fall under one
                  // _isBareAck function.
                  const { _isBareAck } = require('./sse_rewriters');
                  let detectedAck = false;
                  for (const b of parsed.content) {
                    if (b && b.type === 'text' && typeof b.text === 'string'
                        && _isBareAck(b.text)) {
                      detectedAck = true;
                      break;
                    }
                  }
                  if (detectedAck) {
                    // Stat-only -- write to a SEPARATE log (mirrors SSE-path
                    // policy in sse_rewriters.js). Strip is the cure; logging
                    // to errors.log re-fired the alert every turn.
                    try {
                      const fs = require('fs');
                      const path = require('path');
                      const _ackContext = userIsDeny ? 'cascade-after-deny' : 'cascade-no-deny';
                      fs.appendFileSync(
                        path.join(PROJECT_ROOT, 'log', 'hme-bare-ack-strips.jsonl'),
                        JSON.stringify({
                          ts: new Date().toISOString(),
                          path: 'non-sse',
                          context: _ackContext,
                        }) + '\n',
                      );
                    } catch (_e2) { /* stat is best-effort */ }
                    if (userIsDeny) {
                      parsed.content = parsed.content.filter((b) => {
                        if (!b || b.type !== 'text' || typeof b.text !== 'string') return true;
                        return !_isBareAck(b.text);
                      });
                      const newBuf = Buffer.from(JSON.stringify(parsed), 'utf8');
                      clientRes.end(newBuf);
                      return;
                    }
                  }
                }
              }
            } catch (_e) { /* best-effort -- fall through to verbatim */ }
            clientRes.end(outBuf);
          }
          // Stop-hook fallback (post-response, after recent /hme/lifecycle Stop
          // miss): only fire when final assistant message has no tool_use --
          // approximates real turn end and avoids mid-turn retrigger.
          const _hasToolUse = (() => {
            try {
              // Non-streaming: outBuf is the JSON message with .content blocks.
              // Parse-fail defaults to no-tool-use so the fallback still fires.
              const outStr = (outBuf && typeof outBuf.toString === 'function')
                ? outBuf.toString('utf8') : '';
              if (!outStr || !outStr.trimStart().startsWith('{')) return false;
              const parsed = JSON.parse(outStr);
              if (!parsed || !Array.isArray(parsed.content)) return false;
              for (const b of parsed.content) {
                if (b && b.type === 'tool_use') return true;
              }
              return false;
            } catch (_) { return false; }
          })();
          if (isAnthropic && !_hasToolUse && _lifecycleInactive('Stop')) {
            try {
              const stopSession = payload ? sessionKey(payload) : 'unknown';
              const stdin = JSON.stringify({ session_id: stopSession, transcript_path: '' });
              _runInlineFallback('Stop', stdin);
            } catch (e) {
              console.error('inline Stop threw:', e.message);
            }
          }
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
